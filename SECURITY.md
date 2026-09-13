# Security policy

Please do not report a vulnerability, credential, private vault content, or other sensitive material in a public issue.

Use [GitHub private vulnerability reporting](https://github.com/c4g-john/scottsearch-for-obsidian/security/advisories/new) so the details are visible only to repository maintainers. Include the affected version, impact, reproduction steps, and any suggested mitigation that you can safely share.

## Model supply chain

Experimental on-device model files are treated as untrusted data until every artifact matches the immutable revision, exact size, and SHA-256 digest shipped with the plugin. Downloads stage outside the usable model directory and become available only after the complete set passes. ScottSearch never downloads an executable runtime through this path.

If a model download begins without confirmation, reaches an unexpected host, survives a failed integrity check, exposes a partial model as ready, or removes anything outside ScottSearch's dedicated `model-assets` directory, stop using that build and report it privately. The reviewed files and security invariants are documented in [docs/MODEL_ASSETS.md](docs/MODEL_ASSETS.md).
