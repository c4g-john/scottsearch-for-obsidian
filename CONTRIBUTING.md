# Contributing to ScottSearch

Thanks for helping make Obsidian search more deliberate and useful.

## Start with the need

- For a new product need, use the public [Product requirement form](https://github.com/c4g-john/scottsearch-for-obsidian/issues/new?template=product_requirement.yml).
- For planned work, comment on or ask to be assigned to an existing issue before investing in a large change.
- Never include private vault content, credentials, personal data, or confidential screenshots in a public issue or test fixture.
- Report vulnerabilities through [private vulnerability reporting](https://github.com/c4g-john/scottsearch-for-obsidian/security/advisories/new).

The [public roadmap](https://github.com/users/c4g-john/projects/4) is the source of truth for priority and status.

## Development

Requirements:

- Node.js 22.12 or newer
- npm
- A disposable Obsidian test vault

Install and verify:

```sh
npm install
npm run check
```

Use `npm run dev` for a watched development bundle. Copy or symlink the repository into `<test-vault>/.obsidian/plugins/scottsearch/`, then reload Obsidian after code changes.

## Pull requests

Keep each pull request tied to an issue and focused on one coherent outcome.

- Include `Closes #123` when the change fully satisfies an issue.
- Add or update tests for query, ranking, cache, or filter behavior.
- Run `npm run check` before requesting review.
- Explain privacy, compatibility, and performance effects when relevant.
- Include sanitized screenshots for visible UI changes.
- Do not commit generated `main.js`, dependencies, real vaults, or secrets.

Search quality is a product behavior. Ranking changes should include a case that failed before the change, not only an implementation explanation.
