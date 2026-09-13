# On-device model files

ScottSearch's development branch includes a guarded download manager for a future desktop-only on-device semantic experiment. The model is **not used for search yet**. Ollama remains the supported semantic provider, and lexical search still needs no model or network access.

## What happens—and what does not

- Opening Obsidian, opening ScottSearch, and opening Settings make no model network request.
- On desktop, **Settings → ScottSearch → On-device model experiment** opens a review screen.
- The screen shows the model, provider, license, download size, storage size, privacy boundary, and expected future CPU/battery cost.
- A second, explicit confirmation starts the download.
- The download contains model data and tokenizer configuration. It never installs or updates plugin code.
- This download does not read, process, or upload notes.
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
2. Every response is bounded by the reviewed byte count before it can grow in memory.
3. The exact byte count is checked again after download.
4. Web Crypto calculates SHA-256 locally and compares it with the manifest shipped in `main.js`.
5. Files are written to a unique staging directory.
6. Only after all files pass does one directory rename expose the completed model directory.
7. Cancellation, network loss, size mismatch, hash mismatch, or storage failure removes the staging directory. A partial model never becomes ready.

The manager can re-read and re-hash every installed artifact before a runtime uses it. The worker provider tracked in [issue #21](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21) must perform that full check before loading a model.

## Cancel, retry, verify, and remove

The manager shows total progress and which required file is downloading or being verified. Closing the dialog or choosing **Cancel download** aborts the request and removes incomplete files. A later retry begins from a clean staging directory.

After installation, **Verify again** re-hashes every local file. **Remove model files** asks for confirmation, then removes only the dedicated `model-assets` directory. It does not delete or edit notes, lexical data, cached Ollama embeddings, the Ollama endpoint, or other ScottSearch settings.

## Maintainer safety rules

- Never add a model artifact without an immutable revision, exact byte count, SHA-256 digest, and license record.
- Never fetch a remote manifest that can redefine trusted URLs, sizes, or digests at runtime.
- Never start a model download from plugin load, search, settings display, or a migration.
- Never write model data into the notes area or serialize it into `data.json`.
- Never log note content, model request bodies, or raw vault paths from this subsystem.
- Keep the model runtime separate from this manager. Model files are data; executable runtime code must pass normal dependency, review, CI, and release controls.

Run `npm run check` before changing the manifest or manager. The test suite covers opt-in behavior, manifest validation, bounded responses, size and digest mismatch, interruption, cancellation, retry, staging/activation, later corruption, deletion scope, and storage failure.
