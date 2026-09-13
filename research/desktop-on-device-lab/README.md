# ScottSearch Desktop Lab — not a release

This is an unpublished, failure-seeking test artifact for named participants in
[desktop experiment #21](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21).
It enables code that normal ScottSearch releases intentionally compile out.
Compilation proves only that the artifact was assembled; it does **not** prove
that the model is compatible, responsive, or safe enough for a public build.

**Never use this build with a personal vault.** Use only the repository's
fictional 1,000-note test vault and follow the
[frozen desktop matrix](https://github.com/c4g-john/scottsearch-for-obsidian/blob/main/docs/DESKTOP_ON_DEVICE_TEST_MATRIX.md).
Do not publish the generated folder through GitHub Releases, BRAT, another
plugin installer, or an unofficial download link.

## Build and verify

From an exact, clean repository commit:

~~~sh
npm ci
npm run build
npm run build:desktop-lab
git rev-parse HEAD
shasum -a 256 research/desktop-on-device-lab/dist/main.js
cat research/desktop-on-device-lab/dist/EXPECTED_SHA256
node scripts/create-lab-test-vault.mjs desktop
~~~

The command writes only:

~~~text
research/desktop-on-device-lab/dist/
  main.js
  manifest.json
  styles.css
  SAFETY_NOTICE.md
  EXPECTED_SHA256
~~~

The generated directory is ignored by Git. The audit fails unless:

- its manifest says **ScottSearch Desktop Lab** with id
  **scottsearch-desktop-lab** and rejects mobile installation;
- the reviewed browser-only runtime, pinned model identity, desktop-lab warning,
  `requestUrl` byte-range transport, and worker network-denial guard are present;
- no direct browser `fetch` or bundled Node/Electron import exists;
- the normal root `main.js` still contains none of the lab/runtime/model markers;
- generated `main.js` matches the repository's reviewed `EXPECTED_SHA256`.

The runtime is compressed by the exact pinned `fflate` version, so macOS,
Windows, and Linux builders must produce the same reviewed bytes. Record the
commit, printed `main.js` SHA-256, and generated corpus SHA-256 from
`SCOTTSEARCH_LAB_IDENTITY.json` in every report. Reject an artifact whose
identity record is missing or different.

## Open only the generated fictional test vault

1. Remove any earlier lab test vault before running the builder; it refuses to
   overwrite an existing target.
2. Open only the generated vault whose temporary path the builder prints.
3. Confirm it contains exactly 1,000 fictional Markdown notes and that the
   plugin list says **ScottSearch Desktop Lab**, not ScottSearch.
4. Follow every case and predeclared budget in the matrix.
5. Record failures, **Unsupported**, and **Not measurable** results without
   turning them into passes.

The lab requires explicit consent before the 23.7 MB model download. Model
files use Obsidian's `requestUrl` API in fixed 1 MiB ranges. The API has no
in-flight abort handle: cancellation stops future ranges and removes staging,
but the already-started range may finish. ScottSearch refuses a retry until
that range finishes, preventing duplicate transfers.

## Stop and remove

Disable **ScottSearch Desktop Lab**, remove its model files through the lab's
model manager when possible, uninstall the lab plugin, and delete the fictional
vault copy. Confirm that the fictional Markdown files remain unchanged. If the
app crashes, reloads, reports memory pressure, or stops responding, stop the run
and record a failure rather than repeatedly retrying.

Post only the sanitized tables from the matrix to issue #21. Do not include a
computer name, private vault content, full path, account identifier, or secret.
