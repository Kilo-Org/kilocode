# Unnecessary `kilocode_change` Marker Audit: PR #12204, Second Pass

Audited PR HEAD `2d92d8dae2cb2d9efc4961b020dabb11ff5564aa` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08` and upstream `v1.17.4` (`abda3515f444c4d28a98953d153c5a3e1892d3d4`).

## Result

No PR-scoped unnecessary markers remain. Immutable-tree classification of all 997 changed paths found zero `markers-only` candidates.

## Resolved Since First Pass

- `packages/opencode/src/plugin/digitalocean.ts` no longer has stale markers around upstream-equivalent branded content and now matches transformed upstream.
- `packages/tui/src/util/signal.ts` no longer has stale markers around `createDebouncedSignal` and now matches transformed upstream.

## Notable Non-Findings

- `packages/opencode/src/mcp/catalog.ts` remains correctly marked because Kilo substantively renames upstream `fetch` to `collect`, with matching call sites.
- Two tree-wide `markers-only` candidates remain outside this PR's changed-file set: `packages/opencode/src/cli/cmd/run/permission.shared.ts` and `packages/sdk/js/src/error-interceptor.ts`.

The standard dry-run CLIs were not run because they hard-code `HEAD` and the shared checkout contains unrelated staged changes. The same transformation and marker-cleaning implementation was applied in memory to immutable blobs without changing the worktree, index, or refs.
