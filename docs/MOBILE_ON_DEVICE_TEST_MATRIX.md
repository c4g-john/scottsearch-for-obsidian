# Mobile on-device experiment test matrix

> **Protocol only — no mobile result has been recorded yet.** Normal ScottSearch
> releases compile out the on-device experiment. This document does not make it
> available, recommend installing an unpublished build, or count desktop/browser
> measurements as mobile evidence.

This protocol freezes the evidence and pass/fail rules for
[mobile decision issue #22](https://github.com/c4g-john/scottsearch-for-obsidian/issues/22)
before a device run begins. It was adopted September 13, 2026.

## Decision population

Record at least one currently supported device in each class:

1. iPhone
2. iPad
3. Android phone
4. Android tablet

If a class is unavailable, record who looked for it, the date, and why it could
not be tested. An unavailable class is not a pass and prevents an
all-mobile-enable recommendation.

Use an exact, reviewable mobile-lab build supplied by the maintainer through the
[non-public lab procedure](../research/mobile-on-device-lab/README.md). Record
its commit, main.js SHA-256, model revision, runtime version, and build command.
Never substitute the public release: public releases intentionally have no
mobile model control. Never distribute the lab build as a GitHub release or
through BRAT.

## Safe workload

Use only the repository's fictional benchmark corpus expanded to 1,000 Markdown
files. The helper at scripts/create-obsidian-test-vault.mjs creates the same
deterministic notes for every run after the maintainer supplies the reviewed
model fixture and lab bundle. Transfer that test vault to the device using the
tester's normal, trusted file-transfer method.

Do not use a personal vault, paste private note text into logs, publish a device
name, or publish a full filesystem path. Report only the device class, general
hardware model, OS/Obsidian versions, approximate free storage, and measurements
below.

Use two clean copies:

- **Download copy:** no model files, for consent, interruption, offline, corrupt,
  and low-storage cases.
- **Measurement copy:** the exact verified model is already installed, for
  repeatable cold/warm timing without network time.

## Fixed pass/fail budgets

These budgets are set before results exist. Do not loosen a budget after seeing
a slow or failing device; recommend a narrower device class or keep the feature
experimental instead.

| Area | Pass budget | Failure |
| --- | --- | --- |
| Privacy and consent | No model request before the two-step approval; note text never appears in a network request; only the reviewed model host is contacted. | Any unapproved request, note upload, telemetry, or executable self-update. |
| Data safety | No note is created, edited, moved, or deleted by the plugin. Removing the model affects only ScottSearch's model directory. | Any vault-content change or deletion outside that directory. |
| Offline startup | With networking disabled, lexical indexing of 1,000 notes becomes usable within 15 seconds and explains semantic fallback. | Startup loop, blank search, crash, or no usable lexical results after 15 seconds. |
| Cold model load | Ready within 15 seconds after verified files are available. | More than 15 seconds, failed load, crash, or app reload. |
| Warm model load | Ready within 5 seconds on a repeat launch. | More than 5 seconds or unreliable reuse. |
| 1,000-note semantic index | Completes within 180 seconds while the app remains usable. | More than 180 seconds, incorrect completion, crash, or app reload. |
| Query inference | After one warm-up query, at least 25 queries have p50 at or below 250 ms and p95 at or below 750 ms. | Either percentile exceeds its budget or results become inconsistent. |
| End-to-end results | With the deliberate 650 ms input delay, the top ten appear within 1.5 seconds at p95. | p95 exceeds 1.5 seconds. |
| UI responsiveness | No visible freeze lasts 1 second; when instrumentation is available, the largest main-thread timer gap is at most 250 ms and fewer than 1% of gaps exceed 100 ms. | A 1-second freeze, repeated lost input, or either instrumented limit is exceeded. |
| Memory pressure | No OS memory warning, forced reload, termination, or missing-result corruption in two consecutive full runs. If a process figure is available, peak delta is at most 512 MiB. | Any warning/reload/termination/corruption, or measured delta above 512 MiB. |
| Battery | One 1,000-note index plus 25 queries consumes no more than 5 battery percentage points while unplugged under the controls below. | More than 5 points, or the device cannot complete the run unplugged. |
| Heat and throttling | No OS thermal warning; a second warm index is no more than 50% slower than the first. | Thermal warning, user-unsafe heat, or more than 50% slowdown. |
| Cancellation | Disabling semantic ranking stops indexing/inference, returns usable lexical search within 5 seconds, and removes incomplete staging files. During a model download, separately record whether the native request continues after cancellation. | UI remains blocked, unsafe partial files remain, or indexing/inference continues. A native request that continues is recorded as a transport limitation and prevents an unqualified mobile-enable recommendation. |
| Suspension recovery | After a 60-second background suspension, the plugin resumes or reaches explained lexical fallback within 10 seconds. | Crash, permanent spinner, corrupt cache, or no usable search after 10 seconds. |

Battery controls: begin between 30% and 90%, unplug power, disable battery-saver
mode, hold brightness near 50%, close other foreground apps, keep the same
network state, and record whole-percentage readings immediately before and
after. If the OS exposes only coarse readings, record that limitation rather
than estimating decimals.

## Required failure and lifecycle cases

Run every case on each device class and record **Pass**, **Fail**, **Unsupported**,
or **Not measurable** with a short reason:

1. Fresh offline startup with no model.
2. Consent screen review followed by cancel before download.
3. Interrupted download, retry, and verification. Record visible cancellation
   time and whether network transfer continues after cancellation; Obsidian's
   `requestUrl` API exposes no abort handle for an in-flight native request.
   ScottSearch limits that request to a 1 MiB range and must not begin a retry
   until the range finishes.
4. One deliberately corrupt model file; verify rejection and clean repair.
5. Low-storage attempt using the safest OS-supported simulation. Never fill a
   personal device to a dangerous level.
6. Complete cold and warm load.
7. Full 1,000-note index, 25-query timing, UI observation, battery, and heat.
8. Disable during indexing, then re-enable.
9. Plugin unload/disable with a worker active.
10. Sixty seconds in the background, resume, and repeat a query.
11. Remove model files and confirm notes plus lexical search remain intact.
12. Restart offline after all cases and confirm lexical fallback again.

Before any positive mobile recommendation, inspect the exact lab bundle and
build metadata for Node or Electron imports and direct browser `fetch`. Model
downloads must use Obsidian's `requestUrl` API. Its full-buffer range responses
and lack of an in-flight abort handle remain measured limitations. Passing a
device test does not waive the
[mobile-development guidance](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development),
[developer policies](https://docs.obsidian.md/community-directory/developer-policies),
or [load-time guidance](https://docs.obsidian.md/plugins/guides/load-time).

## Measurement method

- Use monotonic in-app timing for model load, index duration, query duration,
  cancellation, and resume.
- Record at least 25 post-warm-up query durations and calculate p50/p95 from the
  raw values. Keep the sanitized raw millisecond list with the report.
- Prefer an OS-supported process-memory tool. If none is available, record
  **Not measurable** and report observable memory warnings/reloads separately.
- Use an automated 16 ms UI timer when the mobile WebView exposes safe debugging;
  otherwise record visible freezes and lost input without inventing gap values.
- Record both first-run cold and immediately repeated warm results.

## Reusable evidence table

Environment and identity:

| Field | Value |
| --- | --- |
| Device class / general model | |
| OS version | |
| Obsidian version | |
| ScottSearch lab commit | |
| main.js SHA-256 | |
| Runtime / backend | |
| Model revision | |
| Approximate free storage | |
| Available memory, if known | |
| Measurement tools | |
| Test date | |

Measured results:

| Result | Value | Pass / Fail / Not measurable | Notes |
| --- | ---: | --- | --- |
| Offline lexical ready | | | |
| Cold model load | | | |
| Warm model load | | | |
| 1,000-note first index | | | |
| 1,000-note warm index | | | |
| Query p50 / p95 (25+) | | | |
| End-to-end p95 | | | |
| Largest UI gap / percent over 100 ms | | | |
| Peak memory or observed pressure | | | |
| Battery before / after | | | |
| Heat warning / warm slowdown | | | |
| Cancellation to lexical ready | | | |
| Suspension recovery | | | |

Scenario results:

| Scenario | Pass / Fail / Unsupported / Not measurable | Sanitized observation |
| --- | --- | --- |
| No-consent network boundary | | |
| Interrupted download and retry | | |
| Corrupt file rejection and repair | | |
| Low storage | | |
| Disable during indexing | | |
| Plugin unload | | |
| Background and resume | | |
| Model removal scope | | |
| Final offline restart | | |

## Recommendation rule

After all evidence is public and reviewed, choose exactly one:

- **Enable on mobile:** all four device classes pass every privacy, safety,
  lifecycle, and performance budget.
- **Enable only on named classes:** all safety/privacy gates pass everywhere
  tested, and the named classes pass every performance budget; list exclusions
  in code and documentation.
- **Keep experimental:** evidence is incomplete, unavailable, not measurable, or
  mixed without a privacy/data-safety failure.
- **Do not support mobile:** any privacy or data-safety gate fails, or the
  runtime is broadly unstable. Performance failure alone may instead justify a
  named-class or experimental recommendation.

No unsupported or not-measurable cell may be silently counted as a pass.
