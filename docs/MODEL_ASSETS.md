# On-device model files

ScottSearch's development branch includes a guarded download manager and a
working desktop-only semantic prototype. The prototype is **off by default and
compiled out of normal human-testing releases**. Ollama remains available, and
lexical search still needs no model or network access.

## What happens—and what does not

- Opening Obsidian, opening ScottSearch, and opening Settings make no model network request.
- On desktop, **Settings → ScottSearch → On-device model experiment** opens a review screen.
- The screen shows the model, provider, license, download size, storage size, privacy boundary, and expected CPU/battery cost.
- A second, explicit confirmation starts the download.
- The download contains model data and tokenizer configuration. It never installs or updates plugin code.
- This download does not read, process, or upload notes. Note processing begins only if semantic ranking and the on-device provider are separately enabled.
- Mobile download controls remain unavailable until [the real-device test matrix](https://github.com/c4g-john/scottsearch-for-obsidian/issues/22) reaches a positive decision.

## Reviewed manifest

The first candidate is [Snowflake Arctic Embed XS](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs), whose [pinned model card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs/blob/d8c86521100d3556476a063fc2342036d45c106f/README.md) declares Apache License 2.0.

- Revision: `d8c86521100d3556476a063fc2342036d45c106f`
- Total reviewed download: 23,686,811 bytes (23.7 MB)
- Destination: the `model-assets` folder inside ScottSearch's own Obsidian plugin folder

| Required file | Bytes | SHA-256 |
| --- | ---: | --- |
| `config.json` | 737 | `d7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec` |
| `tokenizer.json` | 711,649 | `91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854` |
| `tokenizer_config.json` | 1,433 | `9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810` |
| `onnx/model_int8.onnx` | 22,972,992 | `e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1` |

> **Maintainer note:** this table mirrors the tested values in [`src/model-assets/manifest.ts`](../src/model-assets/manifest.ts). Do not copy hashes from an untrusted issue or a mutable branch.

## Integrity and activation

ScottSearch treats upstream bytes as untrusted until all checks pass:

1. URLs use HTTPS and include the immutable model revision.
2. Obsidian's `requestUrl` API requests fixed 1 MiB ranges. Every partial
   response must return the exact reviewed `Content-Range`, byte count, and
   buffer length before it is copied into the artifact buffer.
3. The assembled artifact's exact byte count is checked again after download.
4. Web Crypto calculates SHA-256 locally and compares it with the manifest shipped in `main.js`.
5. Files are written to a unique staging directory.
6. Only after all files pass does one directory rename expose the completed model directory.
7. Cancellation stops future ranges and removes the staging directory. Network
   loss, size mismatch, hash mismatch, or storage failure does the same. A
   partial model never becomes ready.

The worker provider re-reads every artifact and verifies the exact buffers it will use, avoiding a check-then-read gap. It then transfers the verified model buffer into a dedicated worker. A missing or changed artifact is rejected and search visibly falls back to lexical ranking.

## What happens when the experiment is enabled

- The model is not read, decompressed, or initialized at plugin startup. The first semantic indexing or query request loads it lazily.
- The release contains a reviewed browser-only ONNX Runtime Web engine. The model download can never replace or update that executable code.
- Tokenization, bounded long-note chunking, model inference, CLS pooling, and vector normalization happen in the worker rather than the Obsidian UI thread.
- Each document uses at most 12 chunks of 510 content tokens plus the model's CLS and SEP tokens. Chunk vectors are normalized, averaged, and normalized again into one 384-dimensional note vector.
- Queries use the model's required `Represent this sentence for searching relevant passages: ` prefix and the same CLS pooling and normalization.
- Normalized vectors are cached in ScottSearch's `data.json`; raw note text and model inputs are not written to that cache.
- Disabling semantic ranking, changing providers, clearing the cache, or unloading the plugin terminates the worker and cancels pending work. The next use starts a fresh verified worker.
- During initialization, cancellation, corruption, or runtime errors, wording search remains usable and the search view explains the semantic fallback.

The experimental worker is unavailable on phones and tablets. The rest of ScottSearch remains cross-platform.

## Cancel, retry, verify, and remove

The manager shows total progress and which required file is downloading or
being verified. Progress advances only after a validated range returns. Closing
the dialog or choosing **Cancel download** stops future ranges, returns control,
and removes incomplete files. Obsidian's `requestUrl` API has no in-flight abort
handle, so the current range—at most 1 MiB—may still finish in the background.
ScottSearch refuses a retry until it finishes, preventing duplicate transfers;
a later retry begins from a clean staging directory.

After installation, **Verify again** re-hashes every local file. **Remove model files** asks for confirmation, stops the active on-device worker, then removes only the dedicated `model-assets` directory. It does not delete or edit notes, lexical data, cached Ollama embeddings, the Ollama endpoint, or other ScottSearch settings. If the removed provider remains selected, searches use lexical fallback until another provider is chosen or the model is downloaded again.

## Maintainer safety rules

- Never add a model artifact without an immutable revision, exact byte count, SHA-256 digest, and license record.
- Never fetch a remote manifest that can redefine trusted URLs, sizes, or digests at runtime.
- Never start a model download from plugin load, search, settings display, or a migration.
- Never write model data into the notes area or serialize it into `data.json`.
- Never log note content, model request bodies, or raw vault paths from this subsystem.
- Keep the model runtime separate from this manager. Model files are data; executable runtime code must pass normal dependency, review, CI, and release controls.

The exact runtime files, hashes, dependency audit, and licenses are recorded in
[`runtime-bundle-audit.json`](../research/on-device-embeddings/results/runtime-bundle-audit.json)
and [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Run `npm run check` before changing the manifest or manager. The test suite
covers opt-in behavior, manifest validation, byte-range assembly, response
headers, size and digest mismatch, interruption, cancellation, retry exclusion,
staging/activation, later corruption, deletion scope, and storage failure.
