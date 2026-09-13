# Synthetic relevance benchmark

This benchmark checks the product promise behind ScottSearch: spend a moment returning a useful top ten instead of presenting every textual occurrence.

Everything in `corpus/` is fictional and was written for this repository. It contains no real vault content, names, paths, or copied notes. The corpus is covered by the repository's MIT license.

## Run it

```sh
npm run benchmark
```

The command indexes the Markdown corpus with the production `RankedSearchIndex`, runs every case in `cases.json`, and prints per-query plus aggregate scores. The same cases also run during `npm test`, so a regression fails CI.

The scorecard reports:

- **Precision@10:** the share of ten result positions occupied by a labeled-relevant note.
- **Recall@10:** the share of all labeled-relevant notes found in the first ten.
- **MRR:** how early the first labeled-relevant note appears; `1.0` means it is first.
- **Constraint pass:** whether exact phrases, exclusions, metadata, and dates return exactly the allowed set.

See [baseline.md](baseline.md) for the checked-in result from the current release.

## What “hybrid” means here

Hybrid cases use deterministic semantic-score fixtures from `cases.json`. The fixtures make ranking tests fast, offline, and identical on every machine. They test fusion and top-ten behavior; they do **not** claim that a particular Ollama model will produce those exact scores.

Real-model and real-vault testing remains part of the human beta. Never add a private note to this benchmark.

## Add a safe regression

1. Reduce the failing situation to its meaning: for example, “a note about asynchronous decisions should answer a query about fewer meetings.”
2. Write one or more completely fictional Markdown notes under `corpus/`. Avoid real people, companies, projects, dates, and quotations.
3. Add each note's public path, timestamps, tags, and file name to `corpus/catalog.json`.
4. Add a case to `cases.json` with the query, the paths that should be relevant, and deterministic semantic scores when the case tests hybrid retrieval.
5. Run `npm run benchmark` and update `baseline.md` only when the changed numbers are understood and intentional.
6. In the pull request, explain the product behavior that changed rather than sharing the original private note.

Relevance labels are judgments. Keep each set small, explain the intent in the case, and prefer a second reviewer when changing an existing label.
