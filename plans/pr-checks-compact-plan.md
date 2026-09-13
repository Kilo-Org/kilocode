# Plan: compact PR checks in the Agent Manager PR panel

## Goal

A green PR with 35 checks must not cost 35 rows. Show signal, hide noise, keep
everything expandable, and never hide a failure.

## Current state

`packages/kilo-vscode/webview-ui/agent-manager/pr/PRChecks.tsx` renders one row
per check in raw `gh` order. There is no grouping, sorting, or deduplication.

## What GitHub does

Reference implementation: `cli/cli` `pkg/cmd/pr/checks/aggregate.go` and
`output.go`.

1. Group by status bucket, not by app or workflow.
2. Order buckets by failure, pending, cancelled, skipped, and success.
3. Sort within a bucket with a natural numeric-aware name comparison.
4. Expand failure and pending groups. Collapse successful and skipped groups.
5. Use count labels such as `1 failing check` and `27 successful checks`.
6. Keep matrix jobs as separate rows.
7. Deduplicate stale reruns by check identity and latest `startedAt`.
8. Use a tally instead of `X of Y`.

## UI preferences

Treat these as intent rules. Use concrete values from the existing stylesheet and
design tokens instead of inventing fixed values.

- Reuse kilo-ui components and existing `pr-panel.css` classes before creating
  new ones. Do not use inline styles or raw hex colors.
- Use icons from the Kilo or upstream icon registry. Do not add inline SVGs.
- Keep one status signal per row. Do not repeat status text when the group label
  already communicates it.
- Improve density by removing duplicate content, not by shrinking type.
- Keep group headings visually below the main `Checks` section heading.
- Never hide failures or pending checks by default.
- Make every collapse reversible in one click and preserve it across remounts.
- Truncate long names with ellipsis. Do not wrap names or displace controls.
- Add an inner scrollbar only after a sensible row-count threshold is reached.
- Localize every user-facing label, including existing status labels.
- Keep aggregate counts unchanged. Grouping is a view concern only.

## Implementation

### Host data

In `packages/kilo-vscode/src/agent-manager/pr/am-pr-utils.ts`:

- Deduplicate check runs before mapping them to `PRCheck` values.
- Treat `TIMED_OUT` and `STARTUP_FAILURE` as failures.
- Treat `EXPECTED` as pending and keep `NEUTRAL` as successful.
- Preserve existing summary semantics for badges and orchestration.

### Pure grouping module

Add `packages/kilo-vscode/webview-ui/agent-manager/pr/pr-check-groups.ts`.

- Export the bucket type and group transformation.
- Export the default expansion rule.
- Export count data for localized summaries.
- Keep it DOM-free and unit-testable.

Use one `Intl.Collator(undefined, { numeric: true })` for natural sorting.

### PR checks component

In `PRChecks.tsx`:

- Render grouped check headings with expandable row lists.
- Keep failures and pending checks open by default.
- Keep success and skipped groups collapsed by default.
- Remove duplicated per-row status words.
- Keep `Fix with Kilo` above the check groups.
- Keep long names and controls usable in the narrow panel.

### Persistence

Extend `pr-comment-state.ts` with the checks section state and per-bucket
overrides. Key it by worktree and pass the worktree ID through `PRPanel.tsx`.

### Localization

Add group labels, status labels, summary separators, and browser-link labels to
every Agent Manager locale. Preserve `{{count}}` placeholders.

## Verification

- Unit test grouping, natural sorting, status mapping, and deduplication.
- Test that successful groups start collapsed and failing groups start expanded.
- Test that expansion survives a component remount.
- Run `bun run compile` in `packages/kilo-vscode/`.
- Run `bun run test:unit`, `bun run lint`, `bun run knip`, and the Agent Manager
  architecture test.
- Capture before and after Agent Manager screenshots with the same viewport and
  representative check data.

## Expected result

```text
Checks                                  5 pending · 1 failing
  [Fix with Kilo]
  v  1 failing check
       Vercel - docs                                    [link]
  v  5 pending checks
       test (linux)                                     [link]
       typecheck                                        [link]
  >  29 successful checks
```

All-green checks should appear as one collapsed `35 successful checks` line.

## Out of scope

- Required badges, which need an additional GraphQL request.
- Workflow grouping, which GitHub uses on the Checks tab rather than the merge box.
- Merging matrix jobs into one row.
