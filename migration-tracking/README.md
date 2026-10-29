# Kilo v2 migration

Kilo moves onto the upstream OpenCode v2 runtime on the integration branch `origin/v2`. This directory holds stable content only.

| What | Where |
|---|---|
| Live state: status, owners, progress | GitHub: root issue [#15297](https://github.com/Kilo-Org/kilocode/issues/15297), its feature epics, milestones M1 to M4, [Project 42](https://github.com/orgs/Kilo-Org/projects/42) |
| Intent: objective, milestones, epics, scope | [`plan.md`](plan.md) |
| Technical rules: direction, placement, clients, identity, behavioral reference | [`principles.md`](principles.md) (overrides any other doc) |
| Procedure: branches and PRs, placement how-to, isolation, self-test, tests, evidence | `.kilo/skills/` (`v2-migration`, `v2-feature-placement`, `kilocode-merge-minimizer`) |
| Generated v1 inventory per feature | [`progress/`](progress/) (`bun script/upstream/progress.ts`; CI checks it) |
| Known upstream failures at the current base | [`technical-notes/baseline/pinned-v2-baseline.md`](technical-notes/baseline/pinned-v2-baseline.md), reproduced by [`technical-notes/script/v2-baseline.ts`](technical-notes/script/v2-baseline.ts) |
| What a v1 client changes to talk to v2 | [`technical-notes/v1-v2-client-breaking-changes.md`](technical-notes/v1-v2-client-breaking-changes.md) |

The previous plans, decision log, discovery reports, marker audits, test plans and technical notes were removed on 2026-10-28 ([#15294](https://github.com/Kilo-Org/kilocode/issues/15294)). They remain in history at commit `e39551c9b0` (`git show e39551c9b0:migration-tracking/<path>`).
