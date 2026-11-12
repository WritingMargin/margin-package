# API playground

A small portable plugin demonstrating a reader-enabled HTTP action. Its block accepts a JSON object, sends `api.request` and displays a safe JSON response. No URL, API key, runtime or server is packaged.

```sh
node examples/plugins/http-playground/build.mjs /tmp/http-playground-0.1.0.margin-plugin
node --test examples/plugins/http-playground/plugin.test.mjs
```

Install it, configure your HTTPS base URL and optional authentication in Margin settings, and explicitly enable reader requests. Your service implements `POST /try`, accepting and returning JSON objects. Use service-side authorization and rate limits appropriate to public reader requests. The iframe cannot select arbitrary URLs or see credentials.

In the article editor insert **API playground** and choose the starting request JSON. Both author and reader can use **Send request**; only the editor can stage a changed default. The example is UI-only: deploy your own HTTP service separately.
