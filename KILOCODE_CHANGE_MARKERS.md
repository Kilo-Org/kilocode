# Review: Accidental kilocode_change marker removal in PR #9978

> NOTE: this report was reconstructed from the review subagent's final summary because an earlier scratch write of the markdown was lost when the working tree was reset. The methodology, raw counts and verdicts below match what the agent reported. A human should re-run the spot-checks for any line items they care about.

## Methodology

1. Listed all files changed by PR #9978 vs Kilo `main` (`c1ea8100e`):
   `git diff --name-only c1ea8100e..pr-9978`
2. Filtered out paths that are exempt from `kilocode_change` markers:
   - `packages/opencode/src/kilocode/**`, `packages/opencode/test/kilocode/**`, anything else with `kilocode` in the path
   - `packages/kilo-*` packages (entirely Kilo-owned)
   - `packages/sdk/js/src/v2/gen/**` (auto-generated)
3. For every remaining file, computed marker counts before / after:
   ```
   git show c1ea8100e:<file> | grep -c kilocode_change
   git show pr-9978:<file>   | grep -c kilocode_change
   ```
4. Investigated every file where the count went **down**.
5. Cross-checked: enumerated all files on `c1ea8100e` that contained `kilocode_change` and verified each is either preserved or accounted for in the PR.

## Files where marker count changed (focused list)

| File | Before | After | Verdict |
|---|---|---|---|
| `packages/opencode/src/server/middleware.ts` | 5 | 3 | OK — markers migrated to extracted `packages/opencode/src/server/cors.ts` (0→3) along with the CORS logic. |
| `packages/opencode/src/server/proxy.ts` | 2 | 1 | OK — upstream now uses `Workspace.Service.use(...)` which makes the missing-`await` bug Kilo was patching structurally impossible. Marker correctly retired. |
| `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` | 2 | 1 | OK — block marker replaced by an inline marker on `Config.withDefault("kilo")`. Same Kilo behavior, terser annotation. |
| `packages/opencode/src/server/routes/ui.ts` | 6 | 3 | OK — upstream rewrote the file. Remaining 3 markers cover the proxy-fallback-replaced-with-404 behavior in both code paths. |
| `packages/opencode/test/server/httpapi-instance.test.ts` | 1 | 0 | OK — marker migrated to the new `httpapi-instance.legacy.test.ts` (0→1), which is the file that still uses the Hono bridge that the marker described. |
| `packages/opencode/src/session/system.ts` | n | n−1 | **Suspicious** — see Findings #1. |
| `packages/opencode/test/cli/tui/thread.test.ts` | n | n−5 | **Suspicious** — see Findings #2. |

All other shared files in the PR retained or grew their marker count.

## Findings

1. **`packages/opencode/src/session/system.ts` lost a standalone `// kilocode_change` marker** that sat right under the Kilo-only `(model, editorContext)` signature. The most likely annotation target was `const project = Instance.project` (legitimately gone in upstream's refactor), but the inline marker on the modified function signature deserves a sanity check. A human should confirm that the surviving `(model, editorContext)` signature still carries some form of `kilocode_change` annotation, or that no Kilo-specific behavior remains around the lost marker.

2. **`packages/opencode/test/cli/tui/thread.test.ts` had its 5 Kilo-default-args (`$0:"kilo"`, `cloud-fork`, `mdns-domain:"kilo.local"`, etc.) removed** when upstream's structural rewrite simplified the test. Production defaults still exist in `packages/opencode/src/cli/cmd/tui/thread.ts` and are still annotated with `kilocode_change`, but no test now asserts they flow through `TuiThreadCommand.handler`. Loss of marker is technically fine (the test changed), but there is now a coverage gap for the Kilo defaults. A human should decide whether to port the assertions into the new test shape.

## Conclusion

No clearly accidental marker losses were found. All decreases in marker counts are traceable to legitimate migrations (markers moved with their code), upstream catching up to Kilo (markers retired), or upstream rewrites where the marker placement no longer applies. Two items above are flagged for human verification.
