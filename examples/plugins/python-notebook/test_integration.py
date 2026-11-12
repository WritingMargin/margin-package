"""Opt-in HTTP and real ipykernel smoke tests: MARGIN_PLUGIN_INTEGRATION=1."""
import json
import os
import threading
import time
import unittest
import urllib.error
import urllib.request

from runtime import Sessions
from server import PluginServer


@unittest.skipUnless(os.environ.get('MARGIN_PLUGIN_INTEGRATION') == '1', 'requires ipykernel and local sockets')
class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.token = 'test-only-service-credential-0123456789'
        self.sessions = Sessions(timeout=1, lease_seconds=1.5, reap_interval=0.05)
        self.server = PluginServer(('127.0.0.1', 0), self.token, self.sessions)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path, payload=None, token=True, identity=None):
        headers = {'Content-Type': 'application/json'}
        if identity:
            headers.update({'X-Margin-Actor-Id': identity[0], 'X-Margin-Publication-Id': identity[1]})
        if token:
            headers['Authorization'] = f'Bearer {self.token}'
        request = urllib.request.Request(self.base + path, headers=headers,
                                         data=None if payload is None else json.dumps(payload).encode())
        try:
            with urllib.request.urlopen(request, timeout=29) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def action(self, name, inputs, actor='owner', publication='engine-a'):
        return self.request('/actions/' + name, inputs, identity=(actor, publication))

    def test_managed_owner_loss_stops_a_running_real_kernel(self):
        self.sessions.timeout = 20
        status, created = self.action('session.create', {'notebookId': 'leased', 'managed': True})
        self.assertEqual(status, 200, created)
        session_id = created['sessionId']
        inputs = {'sessionId': session_id}
        session = self.sessions.get(('owner', 'engine-a'), session_id)
        pid = session.driver.manager.provisioner.pid
        for _ in range(3):
            time.sleep(0.6)
            self.assertEqual(self.action('session.heartbeat', inputs)[0], 200)
        self.assertFalse(session.closed.is_set(), 'Heartbeats failed to keep the kernel alive.')
        self.assertEqual(self.action('session.heartbeat', inputs, publication='other')[0], 404)
        results = []
        runner = threading.Thread(target=lambda: results.append(self.action('cell.execute', {
            **inputs, 'code': 'import signal, time; signal.signal(signal.SIGINT, signal.SIG_IGN); time.sleep(60)'})))
        started = time.monotonic()
        runner.start()
        deadline = started + 2
        while not session.busy.locked() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(session.busy.locked())
        # Simulate abrupt page loss: send no heartbeat and no explicit close.
        runner.join(6)
        self.assertFalse(runner.is_alive(), 'Lease expiry left the cell executing.')
        self.assertIn(results[0][0], (200, 502), results)
        self.assertTrue(session.closed.wait(1))
        session.thread.join(2)
        self.assertFalse(session.thread.is_alive())
        self.assertLess(time.monotonic() - started, 6)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assertEqual(self.action('session.heartbeat', inputs)[0], 404)
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': '1'})[0], 404)
        self.assertEqual(self.action('session.close', inputs)[0], 200)
        self.assertEqual(self.action('session.close', inputs)[0], 200)

    def test_authenticated_stateful_execution_interrupt_restart_and_limits(self):
        self.assertEqual(self.request('/manifest', token=False)[0], 401)
        self.assertEqual(self.request('/manifest')[0], 404)
        self.assertEqual(self.request('/actions/session.create', {'input': {'notebookId': 'old'}, 'context': {'actorId': 'owner'}}, identity=('owner', 'engine-a'))[0], 400)
        status, created = self.action('session.create', {'notebookId': 'notebook-1'})
        self.assertEqual(status, 200, created)
        session_id = created['sessionId']
        inputs = {'sessionId': session_id}
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': 'value = 41'})[0], 200)
        status, result = self.action('cell.execute', {**inputs, 'code': 'print(value + 1)'})
        self.assertEqual(status, 200, result)
        self.assertIn('42', ''.join(output.get('text', '') for output in result['outputs']))
        self.assertEqual(result['executionCount'], 2)
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': ''})[0], 200)
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': '1'}, publication='engine-b')[0], 404)
        status, result = self.action('cell.execute', {**inputs, 'code': "import os; print('MARGIN_PLUGIN_TOKEN' in os.environ)"})
        self.assertEqual(status, 200, result)
        self.assertIn('False', ''.join(output.get('text', '') for output in result['outputs']))

        results = []
        runner = threading.Thread(target=lambda: results.append(self.action('cell.execute', {
            **inputs, 'code': 'import time; time.sleep(30)'})))
        runner.start()
        session = self.sessions.get(('owner', 'engine-a'), session_id)
        deadline = time.monotonic() + 2
        while not session.busy.locked() and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.15)
        self.assertEqual(self.action('session.interrupt', inputs)[0], 200)
        runner.join(5)
        self.assertFalse(runner.is_alive())
        self.assertEqual(results[0][0], 200, results)
        self.assertTrue(any(item.get('ename') == 'KeyboardInterrupt' for item in results[0][1]['outputs']))

        self.assertEqual(self.action('session.restart', inputs)[0], 200)
        status, result = self.action('cell.execute', {**inputs, 'code': 'value'})
        self.assertTrue(any(item.get('ename') == 'NameError' for item in result['outputs']))
        status, error = self.action('cell.execute', {**inputs, 'code': 'import time; time.sleep(30)'})
        self.assertEqual((status, error['code']), (408, 'EXECUTION_TIMEOUT'))
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': '2 + 2'})[0], 200)
        status, error = self.action('cell.execute', {**inputs, 'code': "print('x' * 200000)"})
        self.assertEqual((status, error['code']), (413, 'OUTPUT_LIMIT'))
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': '3 + 3'})[0], 200)
        self.assertEqual(self.action('session.close', inputs)[0], 200)
        self.assertFalse(session.thread.is_alive())
        self.assertEqual(self.action('cell.execute', {**inputs, 'code': '1'})[0], 404)


if __name__ == '__main__':
    unittest.main()
