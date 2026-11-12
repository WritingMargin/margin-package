"""Protocol and runtime regression tests; no Jupyter dependency required."""
import json
import os
import queue
import threading
import time
import unittest
from unittest.mock import patch, Mock

from runtime import JupyterDriver, KernelSession, OutputCollector, PluginError, Sessions, kernel_environment
from server import Handler, PluginServer, check_setup, dispatch, validate_call


class FakeDriver:
    def __init__(self, directory, timeout):
        self.directory = directory
        self.entered = threading.Event()
        self.interrupted = threading.Event()
        self.closed = False

    def execute(self, code):
        self.entered.set()
        self.interrupted.wait(3)
        return {'outputs': [], 'executionCount': 1}

    def interrupt(self):
        self.interrupted.set()

    def restart(self):
        return {'ok': True}

    def kill(self):
        self.interrupt()

    def close(self):
        self.closed = True


class RuntimeTests(unittest.TestCase):
    def test_credentials_are_not_inherited(self):
        with patch.dict(os.environ, {'MARGIN_PLUGIN_TOKEN': 'secret', 'DATABASE_URL': 'private'}):
            env = kernel_environment('/tmp/kernel')
        self.assertNotIn('MARGIN_PLUGIN_TOKEN', env)
        self.assertNotIn('DATABASE_URL', env)
        self.assertEqual(env['HOME'], '/tmp/kernel')

    def test_busy_cell_can_be_interrupted_from_another_request(self):
        session = KernelSession(('author', 'publication'), 'notebook', 2, FakeDriver)
        results = []
        thread = threading.Thread(target=lambda: results.append(session.call('execute', 'slow')))
        thread.start()
        self.assertTrue(session.driver.entered.wait(1))
        with self.assertRaises(PluginError) as raised:
            session.call('execute', 'concurrent')
        self.assertEqual(raised.exception.code, 'SESSION_BUSY')
        session.interrupt()
        thread.join(1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(results[0]['executionCount'], 1)
        directory = session.driver.directory
        session.close()
        self.assertTrue(session.driver.closed)
        self.assertFalse(os.path.exists(directory))

    def test_session_identity_limit_and_expiry(self):
        factory = lambda identity, notebook, timeout: KernelSession(identity, notebook, timeout, FakeDriver)
        sessions = Sessions(maximum=1, ttl=1, factory=factory)
        self.addCleanup(sessions.shutdown)
        identity = ('alice', 'first-publication')
        session_id = sessions.create(identity, 'n')['sessionId']
        for other in [('bob', 'first-publication'), ('alice', 'other-publication')]:
            with self.assertRaises(PluginError) as raised:
                sessions.get(other, session_id)
            self.assertEqual(raised.exception.status, 404)
        with self.assertRaises(PluginError) as raised:
            sessions.create(identity, 'second')
        self.assertEqual(raised.exception.code, 'SESSION_LIMIT')
        session = sessions.get(identity, session_id)
        session.last_used -= 2
        sessions.reap()
        self.assertTrue(session.closed.is_set())
        self.assertFalse(sessions.items)

    def test_managed_lease_renews_and_cannot_revive_expired_kernel(self):
        clock = [100.0]
        factory = lambda identity, notebook, timeout: KernelSession(identity, notebook, timeout, FakeDriver)
        sessions = Sessions(factory=factory, clock=lambda: clock[0], lease_seconds=2, reap_interval=60)
        self.addCleanup(sessions.shutdown)
        identity = ('alice', 'publication')
        session_id = sessions.create(identity, 'managed', managed=True)['sessionId']
        session = sessions.get(identity, session_id)
        clock[0] = 101.0
        self.assertEqual(sessions.heartbeat(identity, session_id), {'ok': True})
        with self.assertRaises(PluginError):
            sessions.heartbeat(('other', 'publication'), session_id)
        with self.assertRaises(PluginError):
            sessions.close(('other', 'publication'), session_id)
        clock[0] = 102.5
        sessions.reap()
        self.assertFalse(session.closed.is_set())
        clock[0] = 103.0
        with self.assertRaises(PluginError):
            sessions.heartbeat(identity, session_id)
        sessions.reap()
        self.assertTrue(session.closed.is_set())
        self.assertNotIn(session_id, sessions.items)
        self.assertEqual(sessions.close(identity, session_id), {'ok': True})
        self.assertEqual(sessions.close(identity, session_id), {'ok': True})

    def test_managed_lease_expires_busy_kernel_but_preserves_api_session(self):
        clock = [100.0]
        factory = lambda identity, notebook, timeout: KernelSession(identity, notebook, timeout, FakeDriver)
        sessions = Sessions(factory=factory, clock=lambda: clock[0], lease_seconds=2, reap_interval=60)
        self.addCleanup(sessions.shutdown)
        identity = ('alice', 'publication')
        managed = sessions.create(identity, 'managed', managed=True)['sessionId']
        regular = sessions.create(identity, 'api')['sessionId']
        session = sessions.get(identity, managed)
        results = []
        worker = threading.Thread(target=lambda: results.append(session.call('execute', 'long cell')))
        worker.start()
        self.assertTrue(session.driver.entered.wait(1))
        clock[0] = 103.0
        sessions.reap()
        worker.join(1)
        self.assertFalse(worker.is_alive())
        self.assertTrue(session.closed.is_set())
        self.assertTrue(session.driver.closed)
        self.assertIsNotNone(sessions.get(identity, regular))
        with self.assertRaises(PluginError):
            sessions.heartbeat(identity, regular)

    def test_stopping_driver_does_not_restart_after_execution_failure(self):
        driver = object.__new__(JupyterDriver)
        driver.client = Mock()
        driver.manager = Mock()
        driver.timeout = 20
        driver.stopping = threading.Event()
        driver.stopping.set()
        driver.collect = Mock(side_effect=PluginError(502, 'KERNEL_STOPPED', 'closed'))
        with self.assertRaises(PluginError):
            driver.execute('long cell')
        driver.manager.restart_kernel.assert_not_called()

    def test_output_updates_clear_and_safe_mime_types(self):
        collector = OutputCollector()
        collector.add('execute_input', {'execution_count': 3})
        collector.add('display_data', {'data': {'text/plain': 'old', 'text/html': '<script>bad</script>'},
                                       'transient': {'display_id': 'd'}})
        collector.add('update_display_data', {'data': {'text/plain': 'new'}, 'transient': {'display_id': 'd'}})
        self.assertEqual(collector.outputs[0]['data'], {'text/plain': 'new'})
        self.assertEqual(len(collector.outputs), 1)
        collector.add('clear_output', {'wait': True})
        collector.add('stream', {'text': 'replacement'})
        self.assertEqual(len(collector.outputs), 1)
        self.assertEqual(collector.outputs[0]['text'], 'replacement')
        self.assertEqual(collector.count, 3)

    def test_output_limit(self):
        collector = OutputCollector()
        with self.assertRaises(PluginError) as raised:
            collector.add('stream', {'text': 'x' * (192 * 1024)})
        self.assertEqual(raised.exception.code, 'OUTPUT_LIMIT')

    def test_iopub_correlates_messages_and_waits_for_idle(self):
        def message(kind, content, parent='current'):
            return {'parent_header': {'msg_id': parent}, 'msg_type': kind, 'content': content}
        messages = iter([message('stream', {'text': 'ignore'}, 'previous'),
                         message('execute_input', {'execution_count': 4}),
                         message('stream', {'text': 'hello'}),
                         message('status', {'execution_state': 'idle'})])
        class Client:
            def get_iopub_msg(self, timeout):
                return next(messages)
            def get_shell_msg(self, timeout):
                return {'parent_header': {'msg_id': 'current'}}
        driver = object.__new__(JupyterDriver)
        driver.client = Client()
        collector = OutputCollector()
        driver.collect('current', collector, time.monotonic() + 2)
        self.assertEqual(collector.count, 4)
        self.assertEqual([item['text'] for item in collector.outputs], ['hello'])

    def test_wall_time_is_bounded(self):
        driver = object.__new__(JupyterDriver)
        with self.assertRaises(PluginError) as raised:
            driver.collect('current', OutputCollector(), time.monotonic() - 1)
        self.assertEqual(raised.exception.code, 'EXECUTION_TIMEOUT')


class ProtocolTests(unittest.TestCase):
    def test_failed_creation_response_closes_unreturned_kernel(self):
        handler = object.__new__(Handler)
        handler.server = Mock()
        handler.respond = Mock(side_effect=BrokenPipeError())
        def created():
            handler.unreturned_session = (('author', 'publication'), 'new-session')
            return {'output': {'sessionId': 'new-session'}}
        handler.handle_call(created)
        handler.server.sessions.close.assert_called_once_with(('author', 'publication'), 'new-session')
        self.assertIsNone(handler.unreturned_session)

    def test_setup_reports_missing_dependencies_with_install_command(self):
        with patch('server.importlib.util.find_spec', return_value=None):
            with self.assertRaisesRegex(ValueError, 'pip install -r requirements.txt'):
                check_setup()

    def test_setup_rejects_bad_token_and_port_without_binding(self):
        with patch('server.importlib.util.find_spec', return_value=object()):
            with patch.dict(os.environ, {'MARGIN_PLUGIN_TOKEN': ''}):
                with self.assertRaisesRegex(ValueError, 'MARGIN_PLUGIN_TOKEN'):
                    check_setup()
            with patch.dict(os.environ, {'MARGIN_PLUGIN_TOKEN': 'x' * 32, 'MARGIN_PLUGIN_PORT': '0'}):
                with self.assertRaisesRegex(ValueError, 'MARGIN_PLUGIN_PORT'):
                    check_setup()

    def test_service_requires_strong_token_before_binding(self):
        with self.assertRaises(ValueError):
            PluginServer(('127.0.0.1', 0), '')

    def test_identity_headers_are_required_and_cannot_be_spoofed_via_input(self):
        for identity in (None, ('', 'p'), ('alice', '')):
            with self.assertRaises(PluginError):
                validate_call('session.create', {'notebookId': 'n'}, identity)
        for inputs in ({'notebookId': 'n', 'actorId': 'bob'}, {'input': {'notebookId': 'n'}, 'context': {'actorId': 'alice'}}):
            with self.assertRaises(PluginError):
                validate_call('session.create', inputs, ('alice', 'p'))

    def test_contract_uses_stable_actor_and_publication_identity(self):
        identity, inputs = validate_call('session.create', {'notebookId': 'n'}, ('alice', 'p'))
        self.assertEqual(identity, ('alice', 'p'))
        self.assertEqual(inputs, {'notebookId': 'n'})

    def test_unknown_action_and_oversized_code_rejected(self):
        with self.assertRaises(PluginError):
            validate_call('shell.run', {}, ('alice', 'p'))
        with self.assertRaises(PluginError):
            validate_call('cell.execute', {'sessionId': 's', 'code': 'x' * 65537}, ('alice', 'p'))

    def test_managed_creation_is_optional_strict_boolean(self):
        for managed in (True, False):
            _, inputs = validate_call('session.create', {'notebookId': 'n', 'managed': managed}, ('alice', 'p'))
            self.assertIs(inputs['managed'], managed)
        for managed in ('true', 1, None):
            with self.assertRaises(PluginError):
                validate_call('session.create', {'notebookId': 'n', 'managed': managed}, ('alice', 'p'))

    def test_empty_notebook_cell_is_valid(self):
        _, inputs = validate_call('cell.execute', {'sessionId': 's', 'code': ''}, ('alice', 'p'))
        self.assertEqual(inputs['code'], '')


if __name__ == '__main__':
    unittest.main()
