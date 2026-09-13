# ScottSearch for Obsidian

ScottSearch is deliberate search for [Obsidian](https://obsidian.md). It trades a wall of instant textual matches for a short, ranked set of notes that better reflects what you meant.

The plugin combines a strong local lexical ranker with optional semantic embeddings from [Ollama](https://ollama.com). An unreleased desktop experiment can instead calculate embeddings inside an isolated on-device worker. Power-user constraints stay explicit, results stay sortable and filterable, and lexical search keeps working when a semantic provider is unavailable.

> ScottSearch 0.1 is available as a human-testing pre-release. It has not yet been accepted into Obsidian's community plugin directory, so testers install it with BRAT or the release ZIP.

Visit the [friendly ScottSearch website](https://c4g-john.github.io/scottsearch-for-obsidian/) for a no-code installation guide, five useful tests, the visual roadmap, and the latest download.

## What it does

- Returns 10 relevance-ranked results by default instead of every occurrence.
- Uses BM25-style content relevance with title, path, tag, exact-phrase, and recency signals.
- Optionally reranks by semantic similarity using local Ollama or the explicitly enabled desktop experiment.
- Supports required terms, exact phrases, exclusions, metadata filters, and file-date predicates.
- Sorts by relevance, created date, modified date, or filename.
- Filters an existing result set by folder, tag, or recent modification without recomputing embeddings.
- Cycles cached results through title-only, default, and verbose detail without rerunning search.
- Lets you choose how many source characters verbose previews show before and after the first matching phrase or term.
- Updates its index when notes are created, modified, renamed, or deleted.
- Opens as a native Obsidian view and follows the active theme on desktop and mobile-sized panes.

## Query language

Bare text describes what you mean. Operators add hard constraints.

| Query | Meaning |
| --- | --- |
| `reducing coordination overhead` | Find notes related to this idea. |
| `+consensus` | Require a term beginning with `consensus`. |
| `+"decision record"` | Require this exact phrase. |
| `-draft` | Exclude notes containing this term. |
| `-"split brain"` | Exclude this exact phrase. |
| `path:"Projects/Search"` | Include only a path containing this value. |
| `-path:Archive` | Exclude a path. |
| `file:roadmap` | Filter by filename. |
| `tag:research` | Require a tag. |
| `ext:md` | Filter by extension. |
| `createdafter:2025-01-01` | Created on or after the local date. |
| `createdbefore:2026-01-01` | Created before the local date. |
| `modifiedafter:2025-06-01` | Modified on or after the local date. |
| `modifiedbefore:2025-07-01` | Modified before the local date. |

Operators compose. For example:

```text
distributed coordination +"failure detector" -raft tag:research createdafter:2024-01-01
```

Dates must be real calendar dates in `YYYY-MM-DD` format. ScottSearch shows a query error rather than silently ignoring an invalid operator or date.

## Semantic search with Ollama

Semantic ranking is optional and off by default. Lexical ranking works with no service, account, or API key.

1. Install [Ollama](https://ollama.com/download).
2. Download the default embedding model:

   ```sh
   ollama pull embeddinggemma
   ```

3. In Obsidian, open **Settings → ScottSearch**.
4. Enable **Semantic ranking** and rebuild the index.

The default endpoint is `http://localhost:11434`. You can choose another Ollama endpoint and model, but note text is sent to whichever endpoint you configure. ScottSearch caches normalized embedding vectors in its plugin data and invalidates them when a note, endpoint, or model changes.

If Ollama is stopped, the model is missing, or the response is invalid, the search view explains the fallback and continues with lexical ranking.

## Experimental on-device semantic search

The unreleased development branch contains a working desktop-only prototype. It
is compiled out of normal release downloads, is off by default in experimental
builds, and remains blocked from a testing release until the
[macOS, Windows, and Linux Obsidian matrix](https://github.com/c4g-john/scottsearch-for-obsidian/issues/21)
is complete.

On desktop, **Settings → ScottSearch → On-device model experiment** lets an interested development tester review a 23.7 MB Snowflake Arctic Embed XS download. Nothing downloads until a second explicit confirmation. Every required file is pinned to an immutable revision, limited to an exact size, verified with SHA-256 in staging, and activated only after the whole set passes. Choosing **On-device model (experimental)** then performs model loading, tokenization, note chunking, and inference in a dedicated worker.

The model download contains data, does not read or upload notes, and does not update plugin code. When the provider is enabled, note text and model inference stay inside Obsidian; only normalized embedding vectors are cached in ScottSearch's plugin data. Indexing can be stopped by disabling semantic ranking, and lexical search remains available during failures. Mobile controls stay disabled until the [mobile compatibility, memory, heat, and battery matrix](https://github.com/c4g-john/scottsearch-for-obsidian/issues/22) is complete. See the [plain-language model and privacy guide](docs/MODEL_ASSETS.md), [human-testing steps](docs/HUMAN_TESTING.md), [frozen desktop test matrix](docs/DESKTOP_ON_DEVICE_TEST_MATRIX.md), [non-public desktop lab procedure](research/desktop-on-device-lab/README.md), [predeclared mobile test budgets](docs/MOBILE_ON_DEVICE_TEST_MATRIX.md), and [measured research decision](docs/research/on-device-embeddings.md).

## Privacy

- Lexical indexing happens inside Obsidian.
- Semantic search is disabled until you enable it.
- With Ollama selected, text is sent only to the endpoint shown in settings.
- With the unreleased on-device experiment selected, text is processed in a dedicated worker inside Obsidian and is not uploaded.
- The default endpoint is on the same device and needs no secret.
- The optional experimental model download never starts without a separate confirmation and never contains note text.
- ScottSearch does not include analytics or telemetry.
- Ignored folders and oversized note-body limits are configurable.

The repository and its issues are public. Never paste real private vault content into an issue; use a fictional example with the same shape. Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/c4g-john/scottsearch-for-obsidian/security/advisories/new).

## Install the human-testing release

ScottSearch uses one plugin bundle on macOS, Windows, Linux, iPhone, iPad, and Android. The easiest beta installation is through [BRAT](https://tfthacker.com/brat-plugins):

1. In Obsidian, install and enable **BRAT** from **Settings → Community plugins → Browse**.
2. Open the command menu and run **BRAT: Add a beta plugin for testing**.
3. Paste `c4g-john/scottsearch-for-obsidian`.
4. Enable **ScottSearch** under **Settings → Community plugins**.

Alternatively, download `scottsearch-0.1.3.zip` from the
[0.1.3 human-testing release](https://github.com/c4g-john/scottsearch-for-obsidian/releases/tag/0.1.3).
Unzip it and place the contained `scottsearch` folder inside
`<vault>/.obsidian/plugins/`, restart Obsidian, and enable the plugin.

Back up important notes before testing pre-release software. ScottSearch never changes note contents, and disabling or removing it does not delete notes.

The [complete human-testing checklist](docs/HUMAN_TESTING.md) covers desktop, mobile, lexical and semantic search, keyboard navigation, filters, index updates, and safe removal.

## Install for development

ScottSearch requires Obsidian 1.7.2 or later. Building from source requires Node.js 22.12 or newer.

```sh
git clone https://github.com/c4g-john/scottsearch-for-obsidian.git
cd scottsearch-for-obsidian
npm install
npm run build
```

Copy these files into `<vault>/.obsidian/plugins/scottsearch/`:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian, then enable **ScottSearch** under **Community plugins**.

For active development, run `npm run dev` and point the repository (or a symlink) at the plugin folder in a test vault. Do not develop against your only copy of a real vault.

## Commands

- **ScottSearch: Open search** opens or reveals the integrated search view.
- **ScottSearch: Search selected text** opens the view using the active editor selection.

Inside the search input, use the arrow keys to choose a result, `Enter` to open it, modifier-`Enter` to open a new tab, and `Escape` to clear.

Use the **Detail** control beside the sort and filters to cycle **Title only →
Default → Verbose**. The choice persists. Title-only results keep just the note
title, relevance score, and relative path; verbose results show the configured
context around the earliest matching phrase or term without repeating the
search. Change **Settings → ScottSearch → Verbose result context** to add
20–1,000 characters to each side of the compact preview (100 by default).

## Project and requests

- Read the friendly [installation, testing, and contribution guide](https://c4g-john.github.io/scottsearch-for-obsidian/).
- Follow active work on the public [ScottSearch Roadmap](https://github.com/users/c4g-john/projects/4).
- Submit a structured requirement through the [Product requirement form](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=product_requirement.yml).
- Browse or discuss the [issue backlog](https://github.com/c4g-john/scottsearch-for-obsidian/issues).

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening implementation work.

## Development checks

```sh
npm run check
```

That command runs Obsidian's official plugin lint rules, the unit test suite,
TypeScript validation, the release-safe production bundle, Community-directory
metadata and provenance checks, and the website syntax check. CI runs the same
gate on pushes and pull requests. The
[Community submission runbook](docs/COMMUNITY_SUBMISSION.md) explains the
additional live and human gates.

Run `npm run benchmark` to print the synthetic lexical-versus-hybrid relevance scorecard. The [benchmark guide](benchmarks/README.md) explains the metrics, deterministic semantic fixtures, privacy boundary, and how to add a safe regression case.

Run `npm run --silent benchmark:scale` for a machine-readable engineering
baseline at 100, 1,000, and 10,000 generated fictional documents. Its timing
values are advisory; real Obsidian and device results still belong in the human
beta.

## License

[MIT](LICENSE)
