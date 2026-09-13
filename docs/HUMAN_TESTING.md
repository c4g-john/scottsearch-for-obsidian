# ScottSearch human-testing guide

Thank you for trying an early version of ScottSearch. You do not need to understand code, search algorithms, or GitHub to give useful feedback.

## Before you begin

1. Make sure your important notes are backed up or synced normally.
2. Install ScottSearch with the [friendly website instructions](https://c4g-john.github.io/scottsearch-for-obsidian/#install).
3. Keep private note text, names, and vault paths out of public reports. If something fails, make a fictional note with the same shape and use that in your example.

ScottSearch reads notes to build its search index. It does not change note contents. Semantic ranking is optional and off by default.

## The test pass

Use whichever desktop and mobile devices are available to you. It is helpful—not required—to mention the device, operating system, Obsidian version, approximate note count, and theme in your report.

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

Expected: the same visible result set changes predictably and controls never get stuck.

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

## Send useful feedback

A good report can be only three sentences:

1. What you tried.
2. What you expected.
3. What happened instead.

Use the [bug form](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=bug_report.yml) when something appears broken. Use the [product requirement form](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=product_requirement.yml) when ScottSearch needs to support a new outcome.

Both forms are public. Replace private examples before submitting.
