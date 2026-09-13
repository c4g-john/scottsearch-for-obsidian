# Desktop on-device experiment test matrix

> **Protocol only — no desktop Obsidian result has been recorded yet.** Normal
> ScottSearch releases compile out the on-device experiment. Chromium research,
> compilation, and automated tests do not count as a macOS, Windows, or Linux
> Obsidian pass.

This protocol freezes the evidence and pass/fail rules for
[desktop experiment issue #21](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21)
before a platform run begins. It was adopted September 13, 2026.

## Decision population

Record at least one currently supported computer in each class:

1. macOS
2. Windows
3. Linux

If a class is unavailable, record who looked for a tester, the date, and the
reason. An unavailable class is not a pass and prevents an all-desktop testing
release.

Use an exact, reviewable desktop-lab build supplied by the maintainer through
the [non-public lab procedure](../research/desktop-on-device-lab/README.md).
Record its commit, `main.js` SHA-256, model revision, runtime version, and build
command. Also copy the corpus SHA-256 from `SCOTTSEARCH_LAB_IDENTITY.json` so
different test-vault contents cannot be mixed. Never substitute the public
release: public releases intentionally have no on-device model control. Never
distribute the lab through a GitHub release, BRAT, or a public download link.

## Safe workload

Use only the repository's deterministic fictional benchmark corpus expanded to
1,000 Markdown files. After the audited lab build, run
`node scripts/create-lab-test-vault.mjs desktop`.
The builder verifies the lab checksum, uses the distinct lab plugin ID, leaves
semantic ranking off, and refuses to overwrite an existing target. Do not use
personal notes or an everyday vault.

Use two fresh copies on each computer:

- **Download and failure copy:** no model files, for consent, cancellation,
  offline, corrupt, interrupted, low-storage, and repair cases.
- **Measurement copy:** the exact verified model is installed, for repeatable
  load, index, query, responsiveness, memory, and unload measurements.

Do not publish a computer name, user name, full path, note text, model URL query
parameters, or screenshots containing private material. Report the general
hardware class, operating-system version, Obsidian version, approximate memory,
and sanitized measurements only.

## Measurement controls

- Connect the computer to power and disable power-saving mode.
- Close unrelated high-load applications and record unavoidable background work.
- Keep the same network for download cases; network time is recorded but has no
  pass budget because connection speed is not a plugin property.
- Start memory measurement before enabling the lab. Measure the whole Obsidian
  process tree, including renderer/helper processes, rather than JavaScript heap
  alone.
- Use Activity Monitor on macOS, Task Manager on Windows, or an equivalent
  process monitor on Linux. Record the tool and whether values are resident,
  working-set, or another measure.
- Run the 1,000-note index twice. The first is cold; the immediate repeat after
  a clean worker restart is warm.
- After one warm-up query, time at least 25 queries from the fixed fictional set.
- Record raw millisecond values used for p50 and p95. Do not estimate missing
  values or turn **Not measurable** into a pass.

## Fixed pass/fail budgets

These budgets are fixed before results exist. A slower or failing platform does
not justify editing the budget after the run.

| Area | Pass budget | Failure |
| --- | --- | --- |
| Privacy and consent | No model request before the two-step approval; note text never appears in a network request; only the reviewed model host is contacted. | Any unapproved request, note upload, telemetry, or executable self-update. |
| Data safety | No note is created, edited, moved, or deleted by the plugin. Removing the model affects only the desktop lab model directory. | Any vault-content change or deletion outside that directory. |
| Offline startup | With networking disabled, lexical indexing of 1,000 notes becomes usable within 15 seconds and explains semantic fallback. | Startup loop, blank search, crash, or no usable lexical results after 15 seconds. |
| Cold model load | A new Obsidian process reaches on-device ready within 10 seconds after verified files are available. | More than 10 seconds, failed load, crash, or process reload. |
| Warm model load | A clean replacement worker in the same Obsidian session reaches ready within 5 seconds. | More than 5 seconds or unreliable reuse. |
| 1,000-note semantic index | Completes within 120 seconds while search and settings remain usable. | More than 120 seconds, incorrect completion, crash, reload, or blocked UI. |
| Query inference | At least 25 post-warm-up queries have p50 at or below 100 ms and p95 at or below 250 ms. | Either percentile exceeds its budget or identical inputs become inconsistent. |
| End-to-end results | With the deliberate 650 ms input delay, the top ten appear within 1.25 seconds at p95. | p95 exceeds 1.25 seconds. |
| UI responsiveness | No visible freeze lasts 1 second; when instrumented, the largest main-thread timer gap is at most 250 ms and fewer than 1% of gaps exceed 100 ms. | A 1-second freeze, repeated lost input, or either instrumented limit is exceeded. |
| Process memory | No OS memory warning, forced reload, termination, or corrupted result in two full runs. Peak process-tree memory delta from the recorded baseline is at most 1 GiB. | Any warning/reload/termination/corruption, or peak delta above 1 GiB. |
| CPU recovery | Process-tree CPU returns below 10% of one logical core within 30 seconds after indexing finishes or is cancelled. | Sustained work beyond 30 seconds without another requested operation. |
| Cancellation | Disabling semantic ranking stops worker indexing/inference and returns usable lexical search within 3 seconds; incomplete staging is removed. During download, no new range starts and the current at-most-1-MiB native range is recorded separately. | Worker work continues, UI stays blocked, unsafe partial files remain, or another range starts. |
| Restart and unload | Disable/unload completes without a stuck worker; restart reaches ready or explained lexical fallback within 10 seconds. | Crash, permanent spinner, orphaned work, corrupt cache, or no usable lexical search after 10 seconds. |

## Required failure and lifecycle cases

Run every case on each operating-system class and record **Pass**, **Fail**,
**Unsupported**, or **Not measurable** with a short reason:

1. Fresh offline startup with no model.
2. Consent review followed by cancel before download.
3. Cancel during a model range; record visible cancellation time, staging
   cleanup, whether the bounded range finishes, and retry exclusion.
4. Interrupted download, retry, and full SHA-256 verification.
5. One deliberately corrupt model file; verify rejection and clean repair.
6. Low-storage attempt using a safe OS-supported method. Never fill a primary
   disk to a dangerous level.
7. Complete cold and warm model loads.
8. Full cold and warm 1,000-note indexes with process-tree memory, CPU, and UI
   observations.
9. At least 25 fixed queries plus end-to-end result timing.
10. Disable semantic ranking during indexing, then re-enable it.
11. Disable the plugin with a worker active; confirm no worker remains busy.
12. Remove model files and confirm fictional notes plus lexical search remain.
13. Restart offline after all cases and confirm explained lexical fallback.

Before any positive recommendation, inspect the exact lab bundle and build
metadata for direct browser `fetch`, Node, and Electron imports. Model downloads
must use Obsidian `requestUrl` byte ranges, and the inference worker must reject
all network fallback paths.

## Reusable evidence tables

Environment and identity:

| Field | Value |
| --- | --- |
| Operating system and version | |
| General CPU / architecture | |
| Approximate installed memory | |
| Obsidian version | |
| ScottSearch desktop lab commit | |
| `main.js` SHA-256 | |
| Fictional corpus SHA-256 | |
| Runtime / backend | |
| Model revision | |
| Approximate free storage | |
| Process measurement tool / definition | |
| Timing method | |
| Test date | |

Measured results:

| Measurement | Cold | Warm / repeat | Budget result |
| --- | ---: | ---: | --- |
| Model load | | | |
| 1,000-note index | | | |
| Query p50 | | | |
| Query p95 | | | |
| End-to-end p95 | | | |
| Peak process-tree memory | | | |
| Peak delta from baseline | | | |
| Largest UI timer gap | | | |
| Timer gaps over 100 ms | | | |
| CPU recovery time | | | |
| Worker cancellation time | | | |
| Lexical fallback time | | | |

Failure and lifecycle results:

| Case | Result | Sanitized evidence / reason |
| --- | --- | --- |
| No request before consent | | |
| Offline lexical startup | | |
| Cancel before download | | |
| Cancel during bounded range | | |
| Interrupted download and retry | | |
| Corrupt model rejection / repair | | |
| Low storage | | |
| Disable during indexing | | |
| Plugin unload with active worker | | |
| Remove model without note changes | | |
| Offline restart and fallback | | |

Raw query timing list (at least 25 values, milliseconds):

```text

```

## Decision rule

- **Eligible for a public testing pre-release:** every privacy/data-safety gate
  passes, every numeric budget passes on macOS, Windows, and Linux, and no
  required case is unsupported or not measurable.
- **Keep non-public or limit the next experiment:** a platform is unavailable,
  evidence is incomplete, or a performance/resource budget fails without a
  privacy or data-safety failure. Open a scoped issue for each required change.
- **Do not publish the experiment:** any privacy/data-safety gate fails, worker
  network isolation fails, model integrity fails open, or the runtime is broadly
  unstable.

Passing this matrix permits only an explicitly opt-in human-testing build. It
does not make on-device semantics the default and does not decide mobile support.
