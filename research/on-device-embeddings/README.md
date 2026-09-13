# On-device embedding spike

This isolated benchmark supports [GitHub issue #10](https://github.com/c4g-john/scottsearch-for-obsidian/issues/10). It does not ship in the ScottSearch plugin bundle. Read the [measured recommendation](../../docs/research/on-device-embeddings.md) before interpreting its output.

The canonical runner uses current Transformers.js with ONNX Runtime Web's WASM backend in a real Chromium renderer against the repository's fictional relevance corpus. Candidate revisions are pinned, and the output records cold/warm model-loading time, embedding latency, approximate JS heap use, and semantic-only retrieval quality.

```sh
cd research/on-device-embeddings
npm install --ignore-scripts
npm run build:browser
cd ../..
python3 -m http.server 4174 --bind 127.0.0.1
```

Then open one of these URLs:

- `http://127.0.0.1:4174/research/on-device-embeddings/browser/?candidate=arctic-xs&run=cold`
- `http://127.0.0.1:4174/research/on-device-embeddings/browser/?candidate=mxbai-xsmall&run=cold`

To exercise the exact worker and embedded ONNX Runtime bytes used by the plugin,
run `npm run build:worker-harness`, place the reviewed model fixture under the
ignored `research/on-device-embeddings/dist/model/` directory, and open
`http://127.0.0.1:4174/research/on-device-embeddings/browser/worker-index.html?run=local`.

Reload the same candidate with `run=warm` to measure its browser cache. Do not compare cold download time across networks as if it were model inference time. Build output, dependencies, and model caches are ignored.

`benchmark.mjs` remains as a documented negative integration test. A browser-build import under Node downloads the model but fails at the browser/Node resource boundary; run it with `npm run benchmark:node-proxy` only when investigating that upstream behavior.

The Chromium/WASM measurement is a desktop feasibility proxy. It does not prove performance in Obsidian's Electron renderer, Android WebView, or iOS WebKit. Those require the follow-up platform matrix in the recommendation.
