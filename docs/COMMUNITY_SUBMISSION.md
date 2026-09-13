# Obsidian Community submission runbook

This runbook separates checks ScottSearch can prove automatically from decisions
that still need a person. The official process and linked requirements were last
checked on **September 13, 2026**.

## Current official process

Initial plugin submissions now start in the
[Obsidian Community portal](https://community.obsidian.md), not with a pull
request to obsidian-releases. The repository owner must sign in with an
Obsidian account, link GitHub, submit this public repository URL, accept the
developer commitments, and respond to automated or human review feedback.

The authoritative references are:

- [Submit a plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Plugin submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Set up and claim a developer account](https://docs.obsidian.md/community-directory/set-up-and-claim)
- [Plugin load-time guidance](https://docs.obsidian.md/plugins/guides/load-time)

## Automated gates

Run the complete local gate after producing the normal release-safe bundle:

~~~sh
npm run check
~~~

That gate uses Obsidian's official eslint-plugin-obsidianmd recommended rules
and then verifies:

- required repository files and strict manifest naming rules;
- package.json, manifest.json, and versions.json version compatibility;
- non-empty main.js, manifest.json, and styles.css release assets;
- plain-language installation, network, privacy, telemetry, and license
  disclosures;
- exact-version release packaging and GitHub artifact-attestation controls;
- absence of the unreleased on-device runtime, model URLs, and experiment UI
  from the normal production bundle.

The development-only worker can still replace the local root bundle for direct
research with:

~~~sh
npm run build:experiment
~~~

That command is not used by CI or the release workflow. Run `npm run build`
afterward to restore the release-safe `main.js`. Named human testers must not use
that mutable artifact. Their distinct, checksum-pinned kit is built with:

~~~sh
npm run build:desktop-lab
~~~

The desktop lab writes only to an ignored research directory, is checked in CI,
and remains excluded from every GitHub release.

The live, read-only gate checks the public repository, Community catalog, tag,
release state, and required GitHub release assets. Inspect a human-testing
pre-release with:

~~~sh
npm run check:community:live -- --version 0.1.1 --allow-prerelease
~~~

Omit --allow-prerelease for the stable submission gate. The stable gate is
supposed to fail while the selected GitHub release is marked as a pre-release.

## Human gates that automation cannot replace

Do not submit merely because the automated checks pass. The maintainer must also:

1. collect the desktop and mobile smoke-test evidence tracked in
   [beta readiness #20](https://github.com/c4g-john/scottsearch-for-obsidian/issues/20);
2. publish a matching, non-draft, non-prerelease GitHub release whose tag equals
   manifest.json;
3. complete the signed-in Community portal flow and its developer commitments;
4. resolve every automated or human review finding;
5. verify that ScottSearch appears in Obsidian's Community plugins browser and
   installs successfully from that listing.

Track the complete submission decision in
[Community directory submission #11](https://github.com/c4g-john/scottsearch-for-obsidian/issues/11).
