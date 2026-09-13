# ScottSearch Mobile Lab — not a release

This is an unpublished, failure-seeking test artifact for named participants in
[mobile decision #22](https://github.com/c4g-john/scottsearch-for-obsidian/issues/22).
It enables code that normal ScottSearch releases intentionally compile out.
Compilation proves only that the artifact was assembled; it does **not** prove
that the model is compatible, performant, or safe enough for mobile release.

**Never use this build with a personal vault.** Use only the repository's
fictional 1,000-note test vault and follow the
[frozen test matrix](https://github.com/c4g-john/scottsearch-for-obsidian/blob/main/docs/MOBILE_ON_DEVICE_TEST_MATRIX.md). Do not publish
the generated folder through GitHub Releases, BRAT, another plugin installer, or
an unofficial download link.

## Build and verify

From an exact, clean repository commit:

~~~sh
npm ci
npm run build
npm run build:mobile-lab
git rev-parse HEAD
shasum -a 256 research/mobile-on-device-lab/dist/main.js
cat research/mobile-on-device-lab/dist/EXPECTED_SHA256
node scripts/create-lab-test-vault.mjs mobile
~~~

The command writes only:

~~~text
research/mobile-on-device-lab/dist/
  main.js
  manifest.json
  styles.css
  SAFETY_NOTICE.md
  EXPECTED_SHA256
~~~

The generated directory is ignored by Git. The audit fails unless:

- its manifest says **ScottSearch Mobile Lab** with id
  **scottsearch-mobile-lab**;
- the reviewed browser-only runtime, pinned model identity, and mobile-lab
  warning are present;
- no direct browser `fetch` or bundled Node/Electron import exists;
- model downloads use Obsidian's mobile-compatible `requestUrl` API;
- the normal root main.js still contains none of the lab/runtime/model markers.
- the generated main.js matches the repository's reviewed EXPECTED_SHA256.

The runtime is compressed by the exact pinned fflate version rather than the
host's zlib, so macOS and Linux builders must produce the same reviewed bytes.
Record the commit and printed SHA-256 in every device report. A tester should
also record the generated corpus SHA-256 from
`SCOTTSEARCH_LAB_IDENTITY.json`, and reject an artifact whose identity record is
missing or different.

## Transfer only the generated fictional test vault

1. Remove any earlier lab test vault before running the builder; it refuses to
   overwrite an existing target.
2. Transfer only the generated vault whose temporary path the builder prints,
   using a trusted local method.
3. Confirm it contains exactly 1,000 fictional Markdown notes and that the
   plugin list says **ScottSearch Mobile Lab**, not ScottSearch.
4. Follow every case and the predeclared budgets in the matrix.
5. Record failures, Unsupported, and Not measurable results; never turn them
   into passes.

The lab permits the model controls on mobile so the compatibility decision can
be measured. It still requires explicit consent before a model download. Model
files use Obsidian's `requestUrl` API, which returns each response whole rather
than as a stream. ScottSearch requests fixed 1 MiB ranges, validates the range
and size, and advances progress only after each range returns.

The API exposes no abort handle. Pressing cancel returns ScottSearch to lexical
search promptly and removes staging data, but the already-started range—at most
1 MiB—may finish in the background. Record both the visible cancellation time
and any observable continued network activity. Continued transfer is a
limitation, not a pass, and must inform the recommendation in #22. ScottSearch
refuses a retry until that native request finishes so repeated clicks cannot
create duplicate model transfers.

## Stop and remove

Disable **ScottSearch Mobile Lab**, remove its model files from the lab's model
manager when possible, uninstall the lab plugin, and delete the fictional vault
copy. Confirm that the fictional Markdown files remain unchanged. If the app
crashes, reloads, becomes hot, reports memory/storage pressure, or stops
responding, stop the run and record a failure rather than repeatedly retrying.

Post only the sanitized tables from the matrix to issue #22. Do not include a
device name, private vault content, full path, account identifier, or secret.
