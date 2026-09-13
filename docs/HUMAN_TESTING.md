# ScottSearch human-testing guide

Thank you for trying an early version of ScottSearch. You do not need to understand code, search algorithms, or GitHub to give useful feedback.

## Before you begin

1. Make sure your important notes are backed up or synced normally.
2. Install ScottSearch with the [friendly website instructions](https://c4g-john.github.io/scottsearch-for-obsidian/#install).
3. Keep private note text, names, and vault paths out of public reports. If something fails, make a fictional note with the same shape and use that in your example.

ScottSearch reads notes to build its search index. It does not change note contents. Semantic ranking is optional and off by default.

## The test pass

Use whichever desktop and mobile devices are available to you. The friendly test-report form asks for the operating system, Obsidian version, approximate note count, and theme without asking for private vault details.

### 1. Find a remembered idea

- Open ScottSearch from the ribbon or run **ScottSearch: Open search**.
- Describe an idea from a note without copying its exact words.
- Wait for the deliberate search to finish.

Expected: a relevant note appears among the first ten results, or the empty state clearly explains that nothing useful was found.

### 2. Use exact constraints

Try a few made-up examples that fit your vault:

```text
+"decision record"
meeting notes -draft
tag:research createdafter:2025-01-01
path:"Projects/Search" modifiedbefore:2026-01-01
```

Expected: required phrases and filters always apply; excluded notes never appear; an invalid date produces a clear query message.

### 3. Sort and narrow the results

- Change the sort from relevance to filename, created date, and modified date.
- Choose a folder, tag, or recent-modification filter.
- Clear each filter again.
- Use **Detail** to cycle through **Title only**, **Default**, and **Verbose**.
- In ScottSearch settings, change **Verbose result context**, run a search, and return to verbose detail.

Expected: sorting and filters change predictably and controls never get stuck.
Changing detail is immediate and does not show another “Ranking” or “Thinking”
status. Title only contains just title, relevance, and relative path. Default
keeps the familiar three-line preview. Verbose shows the configured amount on
both sides of the earliest literal match; a meaning-only match starts at the
beginning of the note.

### 4. Use only the keyboard

- Type a query and use the up and down arrows to move through results.
- Press `Enter` to open the selected note.
- Use modifier-`Enter` (`Cmd` on macOS, `Ctrl` elsewhere) to open it in a new tab.
- Press `Escape` to clear the query.

Expected: the selected result is visible, the right note opens, and focus remains understandable.

### 5. Try optional semantic ranking

If you do not use Ollama, skip this test. Otherwise:

- Enable semantic ranking in **Settings → ScottSearch** and rebuild the index.
- Search for an idea using synonyms rather than the note's exact words.
- Stop Ollama temporarily and search again.

Expected: meaning-based matches improve when Ollama is available. When it is unavailable, ScottSearch explains the fallback and wording search still works.

### 5a. Try the unreleased on-device experiment (development testers only)

Skip this section when using a normal GitHub release or a phone/tablet. The
prototype is not cleared for a public download. Named development testers must
use the exact **ScottSearch Desktop Lab** artifact and fictional vault described
in the [non-public lab procedure](../research/desktop-on-device-lab/README.md).
Do not install an unspecified development bundle or use personal notes.

Follow the complete [frozen desktop evidence matrix](DESKTOP_ON_DEVICE_TEST_MATRIX.md).
The short workflow is:

1. Connect the computer to power and save other work. Initial indexing uses noticeable CPU and memory.
2. Open **Settings → ScottSearch → Desktop on-device lab — unreleased** and choose **Review model files**.
3. Review the model name, 23.7 MB download, storage, privacy, and license. Nothing downloads until you confirm on the second screen.
4. After the files are ready, choose **On-device model (experimental)** as the semantic provider and enable semantic ranking.
5. Keep using wording search while the index status advances. Try a synonym-based query after it reaches ready.
6. Disable semantic ranking during a rebuild. Wording search should remain available and the indexing work should stop promptly.
7. Re-enable it, then use the model manager's **Remove model files** action when finished.

Expected: the interface remains responsive, note text is not sent to an endpoint,
failures explain that wording ranking is being used, and removing the model does
not change any note. ScottSearch stores normalized vectors in its plugin data so
unchanged notes do not need to be indexed again; clearing the embedding cache
removes those vectors.

Post the sanitized environment, measurement, and failure tables from the frozen
matrix to [issue #21](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21).
Report failures and unavailable measurements as clearly as passes. Never
include real note text, computer names, or paths.

### 6. Check desktop and mobile

- Resize the desktop sidebar to narrow and wide widths.
- If available, repeat the first search on iOS, iPadOS, or Android.
- Try both the default and another installed theme.

Expected: input, filters, result titles, snippets, scores, and controls remain readable without horizontal scrolling.

### 7. Update a note

- Create or edit a fictional note containing an unusual test phrase.
- Search for it, rename it, search again, and then delete it.

Expected: the index follows creates, edits, renames, and deletions without a manual restart.

### 8. Disable and remove the plugin

- In **Settings → Community plugins**, turn ScottSearch off and then on again.
- When finished testing, choose **Uninstall**. If you used BRAT, remove ScottSearch from BRAT's plugin list too.

Expected: Obsidian continues normally and no notes are changed or deleted.

If you downloaded the experimental model, remove it from the ScottSearch model
manager before uninstalling when practical. Obsidian or BRAT may remove the
whole plugin folder during uninstall, but the in-plugin action makes the scope
and result visible first.

## Send useful feedback

A good report can be only three sentences:

1. What you tried.
2. What you expected.
3. What happened instead.

Use the [beta test report](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=beta_test_report.yml) after any test pass—even when everything worked. The form collects approximate platform, theme, vault-size, and timing evidence for the release decision, and every timing question allows **Not measured**.

Use the [bug form](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=bug_report.yml) when something appears broken. Use the [product requirement form](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=product_requirement.yml) when ScottSearch needs to support a new outcome.

All three forms are public. Replace private examples before submitting.
