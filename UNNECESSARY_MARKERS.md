# Unnecessary `kilocode_change` Marker Audit

Revalidated PR [#12204](https://github.com/Kilo-Org/kilocode/pull/12204) at current HEAD `472247daa9063cf7dfea423bec64c46cea44ba36` on `review/upstream-12204-latest` against base `c49560af0f94459015d3fa4e1efa23ad9b291955`. The reset tools resolved the last merged upstream to `v1.17.4` (`abda3515f444c4d28a98953d153c5a3e1892d3d4`). The previous audit targeted force-pushed-away HEAD `2ca787fa4d`; both findings below remain at the current HEAD.

## Findings

1. **`packages/opencode/src/plugin/digitalocean.ts:61`, `:120`, and `:346` retain unnecessary markers.** The file is `markers-only` relative to transformed upstream. Manual comparison showed that transformed upstream already contains the Kilo package imports and branding; its only differences from the checked-out file are the two block-marker lines around `HTML_CALLBACK` and the inline marker on the OAuth instruction. `reset-to-upstream.ts --dry-run` confirms the file would reset. Remove those three marker comments without changing the branded content.

2. **`packages/tui/src/util/signal.ts:3` and `:19` retain unnecessary markers.** Upstream `v1.17.4` now contains `createDebouncedSignal` byte-for-byte. The checked-out file differs only by the start/end comments that describe it as a port of `anomalyco/opencode#31748`. `reset-to-upstream.ts --dry-run` confirms the file would reset. Remove the two marker comments.

## Notable Non-Findings

- `packages/opencode/src/cli/cmd/run/permission.shared.ts` was the only other `markers-only` result in the reviewed source scopes, but `git diff --name-only c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD` does not include it. It is pre-existing drift and not a PR #12204 finding.
- The force-push delta from old HEAD `2ca787fa4d` changes only `packages/http-recorder/package.json`, `packages/opencode/src/mcp/catalog.ts`, and `packages/opencode/src/mcp/index.ts`. Neither marker-only finding changed.
- `packages/opencode/src/mcp/catalog.ts:69` is a new two-line `small-diff`, not `markers-only`. Manual transformed-upstream comparison shows the substantive Kilo rename `fetch` to `collect`, and current callers use `McpCatalog.collect`; its inline marker remains necessary.
- The current scoped checks produced no additional `markers-only` candidates. `packages/http-recorder/package.json` remains `large-diff` (6 lines), and other `small-diff` results were not treated as unnecessary-marker findings because the classifier found substantive non-marker drift.

## Relevant Command Output

The required repo-wide invocation was rerun at current HEAD. It completed all 732 classifications but exceeded the environment's 120-second command limit before printing the report. The exact relevant tail was:

```text
$ bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 32
[OK] Last merged upstream: v1.17.4 (abda3515)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 332 non-code asset(s)
[INFO] Skipping 1755 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 998
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 266 (missing or too-large)
[INFO] Classifying 732 file(s)...
[INFO] Classified 732/732

<shell_metadata>
shell tool terminated command after exceeding timeout 120000 ms.
</shell_metadata>
```

To obtain complete reports within the limit and restrict the result to current PR-relevant paths, the same dry-run was scoped. The exact relevant output was:

```text
$ bun run script/upstream/find-reset-candidates.ts packages/opencode/src --dry-run --concurrency 32
# Reset-to-upstream candidate report

- Last merged upstream: **v1.17.4** (`abda3515`)
- Scope: `packages/opencode/src`
- Review limit: 5 non-marker diff line(s)
- Mode: dry-run (no writes)
- Total candidates: 242

## Summary

| Bucket | Count | Action |
|---|---|---|
| markers-only | 2 | would reset |
| cosmetic-only | 1 | would reset |
| small-diff | 39 | would reset |
| large-diff | 132 | skipped |
| identical | 33 | nothing to do |
| upstream-missing | 35 | skipped |

## markers-only (2) — would reset

- `packages/opencode/src/cli/cmd/run/permission.shared.ts`
- `packages/opencode/src/plugin/digitalocean.ts`
```

The one new source candidate introduced by the force-push appeared under `small-diff`, not `markers-only`:

```text
## small-diff (39) — would reset

- `packages/opencode/src/mcp/catalog.ts` (2 lines)
```

```text
$ bun run script/upstream/find-reset-candidates.ts packages/tui --dry-run --concurrency 32
# Reset-to-upstream candidate report

- Last merged upstream: **v1.17.4** (`abda3515`)
- Scope: `packages/tui`
- Review limit: 5 non-marker diff line(s)
- Mode: dry-run (no writes)
- Total candidates: 96

## Summary

| Bucket | Count | Action |
|---|---|---|
| markers-only | 1 | would reset |
| small-diff | 12 | would reset |
| large-diff | 46 | skipped |
| identical | 29 | nothing to do |
| upstream-missing | 8 | skipped |

## markers-only (1) — would reset

- `packages/tui/src/util/signal.ts`
```

Intersecting those candidates with the PR changed-file set produced:

```text
$ git diff --name-only c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD -- packages/opencode/src/plugin/digitalocean.ts packages/tui/src/util/signal.ts packages/opencode/src/cli/cmd/run/permission.shared.ts
packages/opencode/src/plugin/digitalocean.ts
packages/tui/src/util/signal.ts
```

Required per-file verification produced:

```text
$ bun run script/upstream/reset-to-upstream.ts packages/opencode/src/plugin/digitalocean.ts --dry-run
[OK] Last merged upstream: v1.17.4 (abda3515)
[INFO] [DRY-RUN] Would reset packages/opencode/src/plugin/digitalocean.ts to transformed upstream v1.17.4
```

```text
$ bun run script/upstream/reset-to-upstream.ts packages/tui/src/util/signal.ts --dry-run
[OK] Last merged upstream: v1.17.4 (abda3515)
[INFO] [DRY-RUN] Would reset packages/tui/src/util/signal.ts to transformed upstream v1.17.4
```

The latest force-push candidate was also verified before manual rejection as an unnecessary-marker finding:

```text
$ bun run script/upstream/reset-to-upstream.ts packages/opencode/src/mcp/catalog.ts --dry-run
[OK] Last merged upstream: v1.17.4 (abda3515)
[INFO] [DRY-RUN] Would reset packages/opencode/src/mcp/catalog.ts to transformed upstream v1.17.4
```

Manual transformed-upstream diffs contained only these lines:

```diff
--- transformed-upstream/packages/opencode/src/plugin/digitalocean.ts
+++ packages/opencode/src/plugin/digitalocean.ts
@@
+// kilocode_change start - Kilo branding for the DigitalOcean OAuth callback page
 const HTML_CALLBACK = `<!doctype html>
@@
 </html>`
+// kilocode_change end
@@
-                "Sign in to DigitalOcean in your browser. Kilo will use your DigitalOcean API token directly for inference and load your Inference Routers. Re-run /connect to refresh routers later.",
+                "Sign in to DigitalOcean in your browser. Kilo will use your DigitalOcean API token directly for inference and load your Inference Routers. Re-run /connect to refresh routers later.", // kilocode_change
```

```diff
--- transformed-upstream/packages/tui/src/util/signal.ts
+++ packages/tui/src/util/signal.ts
@@
+// kilocode_change start - port anomalyco/opencode#31748 for Node build conditions
 export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, (value: T) => void] {
@@
 }
+// kilocode_change end
```

By contrast, the current `mcp/catalog.ts` transformed-upstream diff contains a real code rename, so it is not markers-only:

```diff
--- transformed-upstream/packages/opencode/src/mcp/catalog.ts
+++ packages/opencode/src/mcp/catalog.ts
@@
-export function fetch<T extends { name: string }>(
+export function collect<T extends { name: string }>( // kilocode_change - distinguish collection from direct network fetch
```

The force-push delta was:

```text
$ git diff --name-status 2ca787fa4d..HEAD
M packages/http-recorder/package.json
M packages/opencode/src/mcp/catalog.ts
M packages/opencode/src/mcp/index.ts
```

## Limitations

- The current repo-wide finder report could not print before the fixed 120-second sandbox timeout, despite classification reaching `732/732`; complete current `packages/opencode/src`, `packages/tui`, and force-push-affected `packages/http-recorder` scoped runs were used, while unchanged scope results from the prior audit remain applicable.
- The finder excludes non-code assets, config-protected paths, and Kilo-owned paths by design. This audit follows that policy and focuses on shared files where `kilocode_change` markers are meaningful.
- `digitalocean.ts` differs from raw upstream through package-name and branding substitutions. The finding is specifically that its markers are stale relative to the reset tool's transformed-upstream baseline, not that raw upstream contains Kilo branding.
