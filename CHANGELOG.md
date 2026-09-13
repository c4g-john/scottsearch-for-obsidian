# Changelog

All notable changes to ScottSearch will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Synthetic 21-note relevance corpus, deterministic hybrid fixtures, P@10/recall@10/MRR scorecard, and exact constraint regressions.
- Desktop-only, consent-first model asset manager with pinned manifests, bounded downloads, SHA-256 verification, atomic staging, progress, cancellation, retry, re-verification, and scoped deletion.
- Experimental desktop semantic provider using Snowflake Arctic Embed XS int8 in a dedicated worker, with lazy verified loading, in-worker tokenization and bounded note chunking, CLS pooling, normalized 384-dimensional embeddings, cancellation, disposal, and lexical fallback.
- Reproducible exact-worker benchmark and runtime asset audit for the on-device prototype. Cross-platform Obsidian measurements remain a release gate.
- Friendly beta test report form for sanitized platform, theme, vault-size, checklist, and approximate timing evidence—including successful test passes.

## [0.1.1] - 2026-09-13

### Added

- Official Obsidian plugin linting and a reproducible Community-directory
  preflight for manifest, repository, release-asset, catalog-collision, and
  provenance checks.
- GitHub artifact attestations for every published release file.

### Changed

- Corrected the declared minimum Obsidian version to 1.7.2, matching the first
  API version ScottSearch actually uses.
- Normal release builds now compile out the unreleased on-device model
  experiment; development builds keep it available for its separate test matrix.
- Updated settings components and command identifiers to satisfy current
  Community scanner rules.

### Fixed

- Stopped forcibly detaching an open ScottSearch pane when the plugin unloads.

## [0.1.0] - 2026-09-13

### Added

- Native Obsidian search view with deliberate input timing and keyboard navigation.
- Power-user query language for required phrases, exclusions, metadata, and created/modified dates.
- BM25-style local ranking, contextual snippets, facets, filters, and sort modes.
- Optional Ollama embeddings with hybrid semantic ranking and lexical fallback.
- Incremental vault indexing, privacy controls, settings, and cached embeddings.
- Public product requirement form, roadmap, CI, and release packaging.
- Friendly GitHub Pages website with no-code installation and testing guides, a visual roadmap, and live release links.

[0.1.0]: https://github.com/c4g-john/scottsearch-for-obsidian/releases/tag/0.1.0
[0.1.1]: https://github.com/c4g-john/scottsearch-for-obsidian/releases/tag/0.1.1
