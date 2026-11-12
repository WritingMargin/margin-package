"""Optional Margin plugin HTTP service. Run only for trusted authors."""
import argparse
import hmac
import importlib.util
import json
import os
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from manifest import MANIFEST
from runtime import PluginError, Sessions

MAX_REQUEST_BYTES = 128 * 1024
ACTIONS = {action['name']: action for action in MANIFEST['actions']}


def validate_call(action, payload):
    if action not in ACTIONS:
        raise PluginError(404, 'ACTION_NOT_FOUND', 'Unknown plugin action.')
    if not isinstance(payload, dict) or set(payload) != {'input', 'context'}:
        raise PluginError(400, 'INVALID_REQUEST', 'Expected input and server context objects.')
    context = payload['context']
    if not isinstance(context, dict) or set(context) - {'actorId', 'publicationId'}:
        raise PluginError(400, 'INVALID_CONTEXT', 'Invalid server context.')
    actor = context.get('actorId')
    publication = context.get('publicationId', '')
    if not isinstance(actor, str) or not actor or len(actor) > 200:
        raise PluginError(400, 'INVALID_CONTEXT', 'An author identity is required.')
    if not isinstance(publication, str) or len(publication) > 200:
        raise PluginError(400, 'INVALID_CONTEXT', 'Invalid publication identity.')
    inputs = payload['input']
    schema = ACTIONS[action]['inputSchema']
    if not isinstance(inputs, dict) or set(inputs) - set(schema['properties']) or not set(schema['required']).issubset(inputs):
        raise PluginError(400, 'INVALID_INPUT', 'The action input has missing or unknown fields.')
    for key, value in inputs.items():
        rules = schema['properties'][key]
        valid = isinstance(value, bool) if rules['type'] == 'boolean' else isinstance(value, str) and rules['minLength'] <= len(value) <= rules['maxLength']
        if not valid:
            raise PluginError(400, 'INVALID_INPUT', f'Invalid {key}.')
    return (actor, publication), inputs


def dispatch(sessions, action, identity, inputs):
    if action == 'session.create':
        return sessions.create(identity, inputs['notebookId'], managed=inputs.get('managed', False))
    if action == 'session.heartbeat':
        return sessions.heartbeat(identity, inputs['sessionId'])
    if action == 'session.close':
        return sessions.close(identity, inputs['sessionId'])
    session = sessions.get(identity, inputs['sessionId'])
    if action == 'cell.execute':
        return session.call('execute', inputs['code'])
    if action == 'session.restart':
        return session.call('restart')
    return session.interrupt()


class PluginServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, token, sessions=None):
        if not isinstance(token, str) or len(token) < 32:
            raise ValueError('MARGIN_PLUGIN_TOKEN must be a random secret of at least 32 characters.')
        self.token = token
        self.sessions = sessions or Sessions()
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def server_close(self):
        self.sessions.shutdown()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    server_version = 'MarginNotebook/0.3'

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, _format, *args):
        # Avoid logging request contents, code, bearer credentials, or session IDs.
        pass

    def respond(self, status, payload):
        encoded = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(encoded)

    def authorize(self):
        expected = f'Bearer {self.server.token}'.encode('utf-8')
        provided = self.headers.get('Authorization', '').encode('utf-8')
        if not hmac.compare_digest(provided, expected):
            raise PluginError(401, 'UNAUTHORIZED', 'A valid service credential is required.')

    def do_GET(self):
        self.handle_call(self.get_payload)

    def get_payload(self):
        self.authorize()
        if self.path != '/manifest':
            raise PluginError(404, 'NOT_FOUND', 'Unknown plugin route.')
        return MANIFEST

    def do_POST(self):
        self.handle_call(self.post_payload)

    def post_payload(self):
        self.authorize()
        if not self.path.startswith('/actions/'):
            raise PluginError(404, 'NOT_FOUND', 'Unknown plugin route.')
        payload = self.read_payload()
        action = self.path[len('/actions/'):]
        identity, inputs = validate_call(action, payload)
        output = dispatch(self.server.sessions, action, identity, inputs)
        if action == 'session.create':
            self.unreturned_session = (identity, output['sessionId'])
        return {'output': output}

    def read_payload(self):
        if self.headers.get_content_type() != 'application/json' or self.headers.get('Transfer-Encoding'):
            raise PluginError(400, 'INVALID_REQUEST', 'Send a JSON body with Content-Length.')
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise PluginError(400, 'INVALID_REQUEST', 'Invalid Content-Length.') from None
        if size <= 0 or size > MAX_REQUEST_BYTES:
            raise PluginError(413, 'REQUEST_LIMIT', 'Request body exceeds its limit or is empty.')
        try:
            return json.loads(self.rfile.read(size))
        except (ValueError, UnicodeError):
            raise PluginError(400, 'INVALID_JSON', 'Request body must be valid JSON.') from None

    def handle_call(self, callback):
        self.unreturned_session = None
        try:
            self.respond(200, callback())
            self.unreturned_session = None
        except PluginError as error:
            self.respond(error.status, {'error': str(error), 'code': error.code})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except TimeoutError:
            self.respond(408, {'error': 'Request timed out.', 'code': 'REQUEST_TIMEOUT'})
        except Exception:
            self.respond(500, {'error': 'The notebook service could not complete the request.', 'code': 'INTERNAL_ERROR'})
        finally:
            if self.unreturned_session is not None:
                try:
                    self.server.sessions.close(*self.unreturned_session)
                except PluginError:
                    pass
                self.unreturned_session = None


def check_setup():
    missing = [name for name in ('ipykernel', 'jupyter_client') if importlib.util.find_spec(name) is None]
    if missing:
        raise ValueError('Missing Python dependencies: ' + ', '.join(missing) +
                         '. Run this interpreter with -m pip install -r requirements.txt first.')
    if len(os.environ.get('MARGIN_PLUGIN_TOKEN', '')) < 32:
        raise ValueError('Set MARGIN_PLUGIN_TOKEN to a random secret of at least 32 characters. '
                         'For local development: export MARGIN_PLUGIN_TOKEN="$(openssl rand -hex 32)"')
    try:
        port = int(os.environ.get('MARGIN_PLUGIN_PORT', '8101'))
    except ValueError:
        raise ValueError('MARGIN_PLUGIN_PORT must be an integer from 1 to 65535.') from None
    if not 1 <= port <= 65535:
        raise ValueError('MARGIN_PLUGIN_PORT must be an integer from 1 to 65535.')
    return os.environ.get('MARGIN_PLUGIN_HOST', '127.0.0.1'), port


def main():
    parser = argparse.ArgumentParser(description='Run the optional Margin Python notebook plugin for trusted authors.')
    parser.add_argument('--check', action='store_true', help='Check dependencies and configuration without starting a server.')
    parser.add_argument('--manifest', action='store_true', help='Print the plugin manifest as JSON without starting a server.')
    args = parser.parse_args()
    if args.manifest:
        print(json.dumps(MANIFEST, indent=2))
        return
    try:
        address = check_setup()
        if args.check:
            print('Dependencies and configuration ready. Run without --check to start the plugin.')
            return
        server = PluginServer(address, os.environ['MARGIN_PLUGIN_TOKEN'])
    except (ValueError, OSError) as error:
        print(f'Cannot start Python notebook plugin: {error}', file=sys.stderr)
        raise SystemExit(1) from None
    print(f'Python notebook plugin listening at http://{address[0]}:{address[1]}', flush=True)
    print('Connect this endpoint in Margin Settings → Integrations → Plugins. Authentication is required.', flush=True)

    def stop(_signum, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
