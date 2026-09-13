# On-device embeddings: measured recommendation

Status: candidate research complete for [issue #10](https://github.com/c4g-john/scottsearch-for-obsidian/issues/10); guarded worker prototype in progress in [issue #21](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21).

## Decision

Do **not** ship a zero-setup on-device model in ScottSearch 0.1.x, and do not make it the default yet.

Proceed with a **desktop-only, explicitly opt-in experiment** after its download, dependency, and worker safeguards exist. Keep Ollama as the supported semantic provider and lexical search as the zero-dependency fallback while that experiment runs. Do not enable an embedded model on iPhone, iPad, or Android until a real-device compatibility, thermal, battery, and memory matrix passes.

The result is a conditional go rather than a rejection: the measured search-time latency and small-corpus relevance are promising, but the first-run payload, memory uncertainty, mobile unknowns, download integrity work, and current dependency audit are not ready for a friendly default.

## What we measured

The reproducible spike uses [Transformers.js 4.2.0](https://www.npmjs.com/package/@huggingface/transformers/v/4.2.0) and ONNX Runtime Web's WASM backend in a Chromium 151 renderer on macOS. It runs the same 21 fictional notes and five semantic queries as ScottSearch's checked-in relevance scorecard.

| Candidate | Observed model assets | Cold model load | Warm model load | Index 21 notes | Mean query | JS heap increase | MRR / P@10 / R@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Snowflake Arctic Embed XS, int8 | 23.7 MB | 3.01 s | 0.24 s | 0.66 s | 9.8 ms | at least 50.1 MB | 1.00 / 0.26 / 1.00 |
| Mixedbread Embed XSmall, int8 | 25.2 MB | 2.69 s | not recorded | 0.63 s | 6.1 ms | at least 52.4 MB | 1.00 / 0.26 / 1.00 |

The heap number is deliberately described as a lower bound: Chromium's `performance.memory` does not account for every WASM or native allocation. Cold load time includes network and cache behavior and should not be confused with inference time. The tested ONNX Runtime package also contains WASM backend variants between roughly 12 MB and 25 MB; a production build must select and self-host only what it uses. The browser benchmark bundle itself is 1.2 MB unminified.

Both candidates matched the synthetic benchmark's existing hybrid result: macro MRR 1.00, precision@10 0.26, and recall@10 1.00. That is an encouraging regression result, not proof about a large personal vault. Arctic is the first experiment candidate because it is smaller, Apache-2.0 licensed, 384-dimensional, and its official card reports a 22.6-million-parameter model and retrieval-focused evaluation. It requires a documented query prefix and CLS pooling. See the [Arctic model card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs) and [Mixedbread model card](https://huggingface.co/mixedbread-ai/mxbai-embed-xsmall-v1).

Raw summarized measurements live in [`research/on-device-embeddings/results/desktop-chromium-summary.json`](../../research/on-device-embeddings/results/desktop-chromium-summary.json). The small benchmark, candidate revisions, SHA-256 digests, and runner are committed so another contributor can reproduce or challenge the decision.

## Exact worker prototype measurement

The guarded prototype replaces the broad Transformers.js dependency with a
small reviewed WordPiece tokenizer and one browser-only ONNX Runtime Web entry
point. The exact generated worker used by the plugin—compressed WASM included—was
then run in Chromium 151 on macOS against the same relevance corpus and 1,000
synthetic note copies.

| Exact worker run | Model load | 1,000-note index | Query p50 / p95 | Largest main-thread timer gap | Recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 339 ms | 33.67 s | 9.9 / 10.1 ms | 53.7 ms | 1.00 |
| Warm | 287 ms | 33.74 s | 9.7 / 10.5 ms | 17.1 ms | 1.00 |

The warm cancellation probe terminated the worker and returned control within
the benchmark clock's sub-millisecond resolution. This proves that the exact
worker bundle can load, tokenize, chunk, infer, cancel, and preserve main-thread
responsiveness in the measured Chromium renderer. It does **not** satisfy the
macOS/Windows/Linux Obsidian matrix or peak-process-memory requirement. Those
remain explicit open gates; `performance.memory` omits some WASM/native memory.
The raw result and limitations are in
[`plugin-worker-macos-chromium.json`](../../research/on-device-embeddings/results/plugin-worker-macos-chromium.json).

## Platform findings

Transformers.js supports browser inference with WASM and offers WebGPU as an acceleration path. Its own WebGPU guide still recommends a fallback because availability varies. ONNX Runtime likewise documents WASM as the default CPU route, WebGPU as optional, and small models as the practical browser target. [Transformers.js overview](https://huggingface.co/docs/transformers.js/en/index), [WebGPU guide](https://huggingface.co/docs/transformers.js/main/guides/webgpu), [ONNX Runtime WebGPU guidance](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).

The actual compatibility surface is more subtle than one option name: the renderer build accepted `device: "wasm"`, while a direct browser-build import under Node advertised `cpu` and then failed to turn the fully downloaded model into a usable buffer. This is why ScottSearch must test inside Obsidian/Electron and mobile WebViews instead of treating a Node benchmark as proof.

Obsidian explicitly says Node and Electron APIs are unavailable on mobile. Its developer guidance also asks plugins to minimize startup work and bundle size, use mobile-compatible network APIs, disclose network use, and avoid self-installing or updating executable dependencies. A model asset can be treated as user-approved data, but the runtime must ship with the reviewed plugin and the download behavior must be clear. [Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development), [load-time guidance](https://docs.obsidian.md/plugins/guides/load-time), [developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## Consent, integrity, and deletion requirements

No model download may start merely because the plugin loads or a setting screen opens. The opt-in flow must show:

- the provider and exact model;
- expected download and storage size;
- the device-only privacy boundary;
- progress, cancel, retry, and a one-click delete action;
- a warning that initial indexing uses noticeable CPU and battery.

Each artifact must be pinned to an immutable model revision and verified after download with Web Crypto SHA-256 against a manifest shipped in the plugin. For the first candidate, the int8 ONNX weight digest measured from the pinned revision is `e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1`.

Transformers.js's model registry can expose file sizes, download progress, cache state, and cache deletion, but its metadata does not supply the digest ScottSearch needs. An open upstream request also documents the need for resumable, integrity-verified downloads. ScottSearch therefore needs its own verified download boundary rather than relying on the default cache as a security promise. [Model registry API](https://huggingface.co/docs/transformers.js/api/utils/model_registry), [upstream integrity/resume request](https://github.com/huggingface/transformers.js/issues/1625).

## Dependency and packaging gate

The original broad Transformers.js spike remains unsuitable as a shipped
dependency because its isolated install pulled unnecessary Node and image paths
with four high-severity advisories. The prototype instead pins
`onnxruntime-web@1.29.0` directly and implements the reviewed BERT WordPiece
tokenization contract in ScottSearch. On 2026-09-13, `npm audit --omit=dev`
reported zero vulnerabilities across the resulting production graph.

The build rejects changed runtime bytes and changed dependency inputs. The only
third-party worker module is `ort.wasm.bundle.min.mjs` (72,894 bytes, SHA-256
`7a3913dc5c7a9c3ad1144f5fbfecd402bc5013bcc886bc67664b18d8a15ab298`),
paired with one WASM binary (13,961,845 bytes, SHA-256
`ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d`).
No Node backend, image library, remote executable, or alternate execution
provider reaches the worker. The runtime's MIT notice is embedded in `main.js`
and included in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

There is a real tradeoff: gzip compression reduces the exact generated worker
to about 4.84 MB, but Obsidian community installation distributes only the
standard plugin bundle. The compressed worker is therefore stored as inert text
inside `main.js`, increasing the whole bundle to about 4.9 MB on every platform.
The WASM is not decompressed, the model is not read, and the worker is not
created until the experiment is used. Actual Obsidian startup and mobile bundle
impact still need measurement before release; the prototype must be rejected or
repackaged if that cost is unacceptable.

## Implementation gates

The desktop experiment may reach human testers only when all of these are true:

1. Model bytes are never downloaded without explicit consent and pass a pinned SHA-256 check before use.
2. Download progress, cancellation, retry, cache size, and deletion are understandable without technical knowledge.
3. Model load, indexing, and queries run outside the UI thread; lexical search remains immediately available.
4. A stopped worker, corrupt model, offline device, or unsupported runtime produces a friendly lexical fallback.
5. The production dependency audit has no unresolved high or critical finding in shipped code.
6. Desktop Obsidian tests cover macOS, Windows, and Linux with cold/warm startup, a 1,000-note index sample, memory, and cancellation.
7. Mobile remains disabled until separate real-device tests pass.

The work is split into public follow-up issues so the experiment cannot quietly bypass these gates:

- [#23: consent-first verified model download and cache manager](https://github.com/c4g-john/scottsearch-for-obsidian/issues/23) — safety foundation implemented
- [#21: desktop worker prototype behind an experiment setting](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21)
- [#22: real-device mobile compatibility, memory, and battery matrix](https://github.com/c4g-john/scottsearch-for-obsidian/issues/22)
