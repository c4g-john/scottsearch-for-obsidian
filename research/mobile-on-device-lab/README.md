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
~~~

The command writes only:

~~~text
research/mobile-on-device-lab/dist/
  main.js
  manifest.json
  styles.css
  SAFETY_NOTICE.md
~~~

The generated directory is ignored by Git. The audit fails unless:

- its manifest says **ScottSearch Mobile Lab** with id
  **scottsearch-mobile-lab**;
- the reviewed browser-only runtime, pinned model identity, and mobile-lab
  warning are present;
- no bundled Node or Electron import exists;
- the normal root main.js still contains none of the lab/runtime/model markers.

Record the commit and printed SHA-256 in every device report. A tester should
reject an artifact whose digest is missing or different.

## Install only in the fictional test vault

1. Back up and remove any earlier lab copy.
2. Copy the generated dist folder to
   <fictional vault>/.obsidian/plugins/scottsearch-mobile-lab.
3. Confirm the plugin list says **ScottSearch Mobile Lab**, not ScottSearch.
4. Follow every case and the predeclared budgets in the matrix.
5. Record failures, Unsupported, and Not measurable results; never turn them
   into passes.

The lab permits the model controls on mobile so the compatibility decision can
be measured. It still requires explicit consent before a model download. The
current streaming download path has an unresolved cross-platform warning from
Obsidian's official linter; a successful download does not waive that review
gate.

## Stop and remove

Disable **ScottSearch Mobile Lab**, remove its model files from the lab's model
manager when possible, uninstall the lab plugin, and delete the fictional vault
copy. Confirm that the fictional Markdown files remain unchanged. If the app
crashes, reloads, becomes hot, reports memory/storage pressure, or stops
responding, stop the run and record a failure rather than repeatedly retrying.

Post only the sanitized tables from the matrix to issue #22. Do not include a
device name, private vault content, full path, account identifier, or secret.
