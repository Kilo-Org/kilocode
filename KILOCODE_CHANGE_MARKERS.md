# `kilocode_change` Marker Review: Upstream PR #12695

## Scope and methodology

Reviewed the complete `git diff --name-status --find-renames 70eeaff3837e29529e26c7c090767df0a3768249 518501a994bcd660e8c6d061b450c32412104004`: **1,502 changed files** (including additions, deletions, and renames). I compared the requested base, merged head, both head parents (`db1eae3583`, `898f0dc40b`), the actual merge base (`f844790ed7`), and upstream `v1.17.13` (`10c894bdee`). Every changed path was classified; source files were scanned for marker additions/removals, malformed or unbalanced blocks, moved Kilo deltas, and release-baseline coverage after upstream branding transforms. Paths containing `kilo`/`kilocode` were treated as marker-exempt, but deletions from those paths were still checked for lost behavior.

## Findings

1. **Critical: the merge is based on stale Kilo commit `f844790ed7`, not the requested base.** `git merge-base <base> <head>` returns `f844790ed7`; 108 commits / 323 files changed between that fork point and `70eeaff`, and 70 non-merge base-side commits have no patch-equivalent in the head. This caused broad Kilo regression, not merely marker drift. Confirmed examples include loss of the base-tip ripgrep diagnostic fix and test (`packages/core/src/ripgrep.ts`, `packages/core/test/ripgrep.test.ts`), unset-config propagation (`packages/opencode/src/config/config.ts` and its Kilo-owned implementation/tests), blocking HttpApi-probe protection, and numerous current VS Code/Agent Manager changes. Rebase/re-merge onto `70eeaff` before attempting local marker repair.

2. **High: four orphan `kilocode_change end` markers were introduced in shared files.** The corresponding starts existed in the base but disappeared during resolution: `packages/llm/src/schema/messages.ts:54`, `packages/opencode/src/provider/auth.ts:121`, `packages/opencode/src/tool/registry.ts:400`, and `packages/opencode/test/session/compaction.test.ts:1295`. These boundaries are semantically invalid and make coverage ambiguous; the marker normalizer reports that all four files would change.

3. **High: `packages/tui/src/component/error-component.tsx:22` starts a block that is never closed.** A nested block at lines 75-113 closes itself, leaving the line-22 start open through EOF. This accidentally marks most of the upstream crash UI as Kilo-owned and can hide future unannotated changes.

4. **High: Kilo's bidirectional markdown adaptation was lost when markdown moved packages.** The base's marked logical properties in `packages/ui/src/components/markdown.css` (`margin/padding/border-inline-start`, `text-align: start`) became unmarked physical left properties in `packages/session-ui/src/components/markdown.css:101-149,267,334`. This is a semantic RTL regression and lost marker coverage in a shared destination; preserve the logical declarations and annotate the destination delta.

5. **Human verification: docs-sync security/reliability hardening appears wholesale reverted by the stale base.** The head deletes `.github/docs-sync/redact-stream.mjs`, removes `redactEnvSecrets`, full stderr artifact handling, ANSI cleanup, `--auto`, pipeline guarding, expanded budgets, and their self-tests; `.github/workflows/docs-sync.yml` now tees unredacted Kilo stdout directly to `docs-sync-out/edit-log.txt`. Confirm whether reverting `d579774960` was intentional; otherwise restore the full change, including markers on shared files.

6. **Human verification: Kilo-authenticated Exa proxy routing appears unintentionally removed.** The head deletes marker-exempt `packages/opencode/src/kilocode/tool/websearch-kilo-exa.ts` and its tests and removes all 17 integration markers from `packages/opencode/src/tool/websearch.ts`. Direct Exa/Parallel MCP routing remains, so authenticated Exa requests no longer use the Kilo REST proxy added by `c0ebf98778`. Confirm product intent; if the proxy is still required, port it to the new core websearch architecture and mark only shared hooks.

## Notable non-findings

- Marker moves into the new shared `packages/schema`, `packages/protocol`, and `packages/server/src/location.ts` files were generally preserved, including editor context, session status/question metadata, durable tool-content compatibility, location middleware, PTY session association, and global config-update events.
- Deletions under Kilo-owned paths and Kilo-only packages correctly require no marker. The deleted Kilo Exa files are reported above because behavior disappeared, not because those files lacked annotations.
- The HTML-template `<!-- kilocode_change ... -->` markers in MCP/Codex callback strings predate this merge and remain balanced; they are not merge-introduced findings.
- Pre-existing malformed boundaries at base in `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/session/message-v2.ts`, and marker-exempt `packages/opencode/test/kilocode/kilo-sessions.test.ts` were not attributed to this PR.

## Commands and limitations

- Primary evidence: `git diff --name-status --find-renames <base> <head>`, parent/combined diffs, `git merge-base`, `git cherry`, `git log -S`, marker-balance scans at base/upstream/head, and transformed `v1.17.13..head` source comparisons using `script/upstream/utils/{markers,upstream}.ts`.
- `bun run script/check-opencode-annotations.ts --base <base>` is not probative here: it intentionally prints `Skipping shared upstream annotation check — upstream merge detected.` Its configured scopes also omit newly shared packages such as `packages/core`, `packages/schema`, `packages/protocol`, and `packages/server`.
- `git diff --check <base> <head>` reports unrelated pre-existing/generated whitespace, principally `packages/sdk/js/src/v2/gen/sdk.gen.ts`; no unresolved conflict markers were found.
- No build or application test suite was run. This was a provenance/marker audit, and the stale ancestry makes a clean validation run less informative until the missing base-side commits are restored.
