# Kilo Change Marker Review

## Scope And Method

Reviewed `origin/main...HEAD` at `51d8031c9997bd5478bcde715562169f732d04d4`, using `v1.17.9` (`5c23e88419c4743b9be42cea132f2fb1e6cb63ff`) as the upstream-merged release baseline. **208 changed files** were checked, including renames, deletions, generated artifacts, Kilo-owned paths, and shared code. For each changed file, I compared the merge-base PR diff with the final `HEAD` version and, where relevant, the `v1.17.9..HEAD` Kilo delta.

The review focused on every removed or moved `kilocode_change` marker, remaining Kilo-only behavior, marker scope, Kilo helper/test deletions, and package moves. It did not treat the repository checker as sufficient evidence because this range contains an upstream-merge-resolution commit.

## Findings

No confirmed accidentally removed, moved, over-broad, or under-broad `kilocode_change` markers found. **Confidence: high.**

The separate unnecessary-marker audit found 27 surviving annotations whose code now matches transformed upstream. Those are stale retained markers, not marker removals caused by this merge; see `UNNECESSARY_MARKERS.md`.

## Notable Non-Findings

- **High confidence:** The two removed markers in `packages/core/src/catalog.ts` correctly disappear with the old credential-to-provider projection. Upstream v1.17.9 moves credential selection into integration connections. Kilo's organization routing is preserved, narrowly marked, in `packages/core/src/session/runner/model.ts:99-104`, with dedicated coverage in `packages/core/test/kilocode/session-runner-model.test.ts:10-56`.

- **High confidence:** Deleting `packages/opencode/src/pty-preparation.ts` removes five markers only because PTY setup moved to the shared core service. Kilo self-command resolution, parent PTY identity, and server-credential scrubbing remain marked in `packages/core/src/pty.ts:11`, `packages/core/src/pty.ts:201-225`; the moved helper is Kilo-owned at `packages/core/src/kilocode/pty-self-command.ts`. The legacy handler still applies the plugin `shell.env` hook before invoking core in `packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts:69-82`. The replacement behavior has direct PTY and HTTP API tests.

- **High confidence:** The removed chronology marker in `packages/opencode/src/session/prompt.ts` belongs to upstream's removed steering-wrapper loop. That enclosing behavior is absent from v1.17.9 as well. Kilo chronology protection remains where it is still needed at `packages/opencode/src/session/prompt.ts:1479-1494`, and the queue-specific ordering logic stays in the Kilo-owned `packages/opencode/src/kilocode/session/prompt-queue.ts:99-119`.

- **High confidence:** The deleted Kilo-owned markdown stable-block helper and tests, `packages/ui/src/kilocode/markdown-stable-blocks.ts` and `packages/ui/src/kilocode/markdown-stable-blocks.test.ts`, are superseded by upstream's richer projection model in `packages/ui/src/components/markdown-stream.ts:52-110`. Kilo-only Mermaid rendering, Kilo theme forwarding, directionality, and highlighted-block preservation remain independently marked in `packages/ui/src/components/markdown.tsx:20-23`, `packages/ui/src/components/markdown.tsx:374-383`, `packages/ui/src/components/markdown.tsx:507-545`, and `packages/ui/src/context/marked.tsx:27-31`.

- **High confidence:** Marker movements caused by package extraction are semantically narrow and intact. Examples include PowerShell handling moved to Kilo-owned `packages/core/src/kilocode/powershell.ts` and imported from marked `packages/core/src/shell.ts:11`, plus CORS allowlisting moved from the old server file to the marked call in `packages/server/src/cors.ts:2,24`, with the Kilo regex isolated in `packages/server/src/kilocode/cors.ts`.

- **High confidence:** The 12 files that remove marker text are accounted for by the upstream catalog/PTY/markdown/prompt refactors or marker relocation. No removed marker leaves an unannotated Kilo delta. Some surviving annotations are no longer necessary because the transformed upstream baseline now contains the same code; those maintenance findings are reported separately in `UNNECESSARY_MARKERS.md`. Generated SDK/OpenAPI files and dependency patches do not require source annotation markers.

## Automated Evidence

- `git diff --name-only origin/main...HEAD | wc -l`: `208`, matching the reviewed changed-file count.

- `git diff --name-status --find-renames origin/main...HEAD`: identified 12 rename/delete entries. The only deleted shared file carrying markers was `packages/opencode/src/pty-preparation.ts`; its behavior was traced to the core PTY and handler paths above.

- `git diff --unified=0 origin/main...HEAD | rg '^[+-].*kilocode_change'`: identified marker movements/removals for semantic review. No unexplained marker removal remained after comparison with `v1.17.9` and `HEAD`.

- `bun script/check-opencode-annotations.ts --base origin/main`: output `Skipping shared upstream annotation check - upstream merge detected.` The range includes `a51864cd75d3f6f4785f2b845a268f3fde4bec97 resolve merge conflicts`, so this result is informational only, not a pass.

- Independent release-baseline coverage scan over all changed source files, excluding Kilo-owned, generated, and checker-exempt paths: no changed `v1.17.9..HEAD` source line requiring a marker was left uncovered. This supplements the skipped repository checker and includes the newly extracted `packages/core` and `packages/server` paths that the repository checker does not enumerate in its shared scopes.

- `git diff --check origin/main...HEAD -- ':!patches/@pierre%2Ftrees@1.0.0-beta.4.patch'`: passed with no output.

## Limitations

- The annotation guard intentionally skips upstream merge ranges, including this one, so it cannot independently prove marker correctness. The finding is based on manual three-way semantic review plus the release-baseline coverage scan.

- `git diff --check origin/main...HEAD` reports whitespace in the upstream-added vendored patch `patches/@pierre%2Ftrees@1.0.0-beta.4.patch`. This is unrelated to markers; excluding that patch yields a clean whitespace check.

- No application test or typecheck suite was run. This was a read-only annotation-provenance review; those suites do not validate marker scope or ownership, and the report calls out the directly relevant annotation checks above.

- Existing untracked reports (`CONFIG_REGRESSION.md`, `INFRASTRUCTURE_CHANGE.md`, `OPENCODE_MENTIONS.md`, and `TESTS.md`) were present in the worktree and were not inspected or modified.
