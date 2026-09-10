# Issue #13750 publication drafts

Local review package, prepared September 10, 2026. The issue body and all nine subissues have been published to GitHub; the progress comment remains unpublished. Existing plans are preserved.

## Review order

1. [Proposed issue body](issue-body.md): retains the original phases and all 36 inventory capabilities, updates status and remaining scope, and replaces the bootstrap next step with current milestones.
2. [Initial progress comment](progress-comment.md): a dated checkpoint to accompany the body update.
3. [Tracking policy](tracking-policy.md): how the issue, repository plan, comments and subissues stay consistent.
4. [Published subissues](published-subissues.md): all nine have been created and linked to the parent; their draft source files remain below.

## Subissue source files

- [Original VS Code client parity](subissues/01-original-vscode.md)
- [Runtime and CLI/TUI parity](subissues/02-runtime-cli-tui.md)
- [Session sharing](subissues/03-session-sharing.md)
- [Remote session acceptance](subissues/04-remote-sessions.md)
- [Distribution and cutover](subissues/05-distribution-cutover.md)
- [Remaining editor services](subissues/06-editor-services-clients.md)

- [JetBrains plugin](subissues/07-jetbrains.md)
- [Cloud agent integration](subissues/08-cloud-agent-integration.md)
- [Anaconda Desktop and related clients](subissues/09-anaconda-client-integration.md)

JetBrains is existing phase-5 scope. Cloud agents and Anaconda are explicitly proposed consumer-assessment work: their required changes are not yet established. They are separate from the `kilo cloud` CLI, remote relay, and VS Code Agent Manager rows.

These are proposed work boundaries. Split a draft further when it gains independent owners or release milestones; do not create one issue per marker or source file.

## Provenance and review limits

[Original issue body](original-issue-body.md) preserves the fetched body of https://github.com/Kilo-Org/kilocode/issues/13750, whose reported last update was September 4, 2026 at 13:55:36 UTC. There were no comments in that fetched snapshot. Keep the title **Phased Plan - Port Kilo onto OpenCode V2**.

Statuses are an editorial reconciliation of recorded local work and remaining acceptance, not a new test run. Review broad “implemented” rows against the expanded plan before publication. The original 36-row inventory, expanded 88-row inventory and historical 43-row checkpoint are different denominators; no new completion percentage is calculated.

## Publication sequence — after review

- Refresh the live issue to detect changes made since the snapshot; preserve any intervening contributions.
- Review the detailed repository plan for stale status, then publish the approved tracking documents with the branch.
- Replace repository path references in these drafts with links to the actual published branch or commit. Do not link to an assumed branch or unpublished files.
- Update the existing issue body in place; retain its identity and original phase structure.
- Create only approved subissues, attach them to #13750, and add their real links to the parent and repository plan.
- Post the dated progress comment. Replace its preparation date if publication occurs later.

This checklist grants no authorization to publish. This package is ready for local editorial review, not automatic submission.

## Editorial review notes

The issue body, progress comment and subissue files are publication text. This README and tracking policy are repository-only preparation material. After review, fold the approved maintenance policy into the existing `migration-tracking/README.md`; do not post it as an issue comment or overwrite that README automatically. Publish the branch before either the body update or progress comment so all supporting paths can be replaced with accessible links.

## Public-link scope and final substitutions

For the first publication, link the reviewed progress plan and `marker-audit/v1-kilo-marker-port-assessment.md` directly. Do not use the whole `migration-tracking/` directory as a public evidence landing page yet: its README and historical supporting files still contain preparation notes, machine-local paths and coordination references. Preserve those originals during this local drafting pass. Clean and review them separately before promoting them as public references.

Before posting, add an actual published branch/commit link to the progress comment and replace its closing work-tracking sentence with the approved, created subissue links. Add the JetBrains issue link to the body. Replace repository paths with real published links throughout the approved texts. The runtime subissue's fork-convention reference also needs a reviewed published link. None of these URLs or issue numbers should be invented in the local drafts.

The dated [v2 shared-source footprint](../../marker-audit/v2-shared-source-footprint-2026-09-10.md) is also intended for publication. Link it from the footprint paragraph using the published branch/commit URL. The file records the measurement scope and file list; explanations of individual hooks remain in source.
