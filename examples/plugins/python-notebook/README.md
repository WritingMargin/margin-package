# Jupyter notebook browser plugin

The portable v0.4 package contains only the notebook editor, import/export, safe output rendering and six declared HTTP actions. It contains no Python interpreter, native runtime or server executable. Saved notebook content and results can be read on any Margin host without Python.

```sh
npm ci --prefix examples/plugins/python-notebook
npm test --prefix examples/plugins/python-notebook
node examples/plugins/python-notebook/build.mjs /tmp/python-notebook-0.4.0.margin-plugin
```

Install the archive and insert **Jupyter notebook**. Import a valid `.ipynb` file or create code, Markdown and raw cells. Run cells individually or sequentially, interrupt or restart the kernel, then choose **Save outputs** and Margin's Insert/Apply to publish results. Edits stage notebook JSON, preserving unknown metadata and fields; code changes clear stale outputs. Preview results are temporary. Readers display saved text/PNG outputs, never execute code or HTML. Export uses Margin's explicit download control.

## Optional external execution service

Running Python requires an independently deployed trusted-author service. Margin does not provision, install or manage it. Use this reference service, or implement the declared raw JSON HTTP routes in another deployment:

```sh
cd examples/plugins/python-notebook
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
export MARGIN_PLUGIN_TOKEN="$(openssl rand -hex 32)"
python server.py --check
python server.py
```

Put the service behind a public HTTPS endpoint. In Margin's plugin settings configure that base URL, authentication header `Authorization`, prefix `Bearer ` and the same secret. The reference Dockerfile/compose are optional external deployments, not engine plugins. Keep code execution restricted to the trusted author; a container alone does not safely isolate hostile tenants.

Actions use `POST /actions/{name}` with the raw input object; responses are raw output objects. Bearer authentication is mandatory. The bridge supplies `X-Margin-Actor-Id` and `X-Margin-Publication-Id`; never take identities from the browser body. Reader execution is rejected. Sessions are scoped to both identities. Keep a dedicated service credential per publication and protect the HTTPS proxy from untrusted access.

Managed editor sessions renew a lease every five seconds. The service expires them after thirty seconds without renewal, including abrupt page loss; explicit close and host cleanup stop kernels sooner. Failed leases stop renewal and the next run creates a fresh session. The service also bounds sessions, output and execution time. Kernels receive a minimal environment without the service token or engine credentials.

```sh
python -m unittest test_plugin.py test_build_package.py
MARGIN_PLUGIN_INTEGRATION=1 python -m unittest test_integration.py
```

The runtime tests exercise the independently hosted Python service. The portable installation lifecycle is tested through `npm run test:plugin-browser`. All notebook UI code and validation remain inside this plugin.
