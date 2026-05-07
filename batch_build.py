import json, sys

MODEL = "kilo/kilo-auto/frontier"

def rec(item_id, track, stale, body, state, last_activity, waiting_on, first_team, mergeable):
    return {
        "item_kind": "pr",
        "item_id": item_id,
        "track": track,
        "stale": stale,
        "assessment": {
            "model": MODEL,
            "body": body,
            "signals_snapshot": {
                "state": state,
                "last_activity_at": last_activity,
                "waiting_on": waiting_on,
                "first_team_response_at": first_team,
                "mergeable": mergeable,
                "stale": stale
            }
        }
    }

items = [
rec(126,"close",True,
"""Summary:
- Adds persistence of per-workspace MCP enabled/disabled state to the config file in `packages/opencode/src/mcp/` (XL, 8 files).

Checks:
- [⚠] Value & approach fit — useful feature; approach needs validation
- [✗] Real-behavior proof — no test coverage for multi-workspace stale-config case
- [✗] Bot findings — WARNING: `.kilocode` MCP defs never found; WARNING: shared config writes leave initiating workspace stale
- [✗] Reviewer comments resolved — bot WARNINGs unaddressed by contributor since March
- [✓] CI & mergeable — mergeable unknown; no CI signal
- [✗] Contributor responsive — waiting_on=contributor; silent since before team routing Apr 14

Recommendation:
- close (stale_contributor): Concrete bot WARNINGs directed at contributor open since March with no follow-through; contributor silent well past 5-day threshold.

Notes:
- markijbema was routed as reviewer Apr 14 but contributor owes the fix.
- PR is 73d old; if re-opened, WARNINGs about stale-config and missing `.kilocode` path must be resolved.""",
"open","2026-04-14T19:07:53Z","contributor","2026-04-14T19:07:53Z",None),

rec(123,"decide",False,
"""Summary:
- Adds a `dev:windows` npm script and supporting polyfill files (~1 030 additions, 8 files) to work around a Bun runtime-plugin bug on Windows.

Checks:
- [⚠] Value & approach fit — Windows-specific workaround; unclear if Bun upstream bug is fixed
- [⚠] Real-behavior proof — contributor confirmed still needed Apr 28; no automated test
- [✓] Bot findings — no CRITICALs noted
- [✓] Reviewer comments resolved — marius-kilocode asked if still needed; contributor confirmed Apr 28
- [⚠] CI & mergeable — CI failures claimed unrelated (upstream breakage); mergeable unknown
- [✓] Contributor responsive — active Apr 28

Recommendation:
- decide: Maintainer call needed on whether a Windows-only dev-path workaround belongs in core scripts or should wait for the upstream Bun fix.

Notes:
- Contributor linked Bun issue oven-sh/bun#9446; verify if that is now resolved before accepting.
- marius-kilocode is the assigned reviewer; needs to surface to a product owner.""",
"open","2026-04-28T20:09:01Z","team","2026-04-24T14:13:35Z",None),

rec(167,"decide",False,
"""Summary:
- Registers Avian (OpenAI-compatible inference provider) as a new API provider in `packages/opencode/src/provider/` (99 additions, 4 files).

Checks:
- [⚠] Value & approach fit — new third-party provider; scope/acceptance decision needed
- [✓] Real-behavior proof — contributor resolved conflicts twice showing continued engagement
- [✓] Bot findings — no CRITICALs; no outstanding WARNINGs
- [✓] Reviewer comments resolved — chrarnoldus asked for conflict fix; contributor resolved Apr 26
- [✓] CI & mergeable — mergeable=clean
- [✓] Contributor responsive — resolved conflicts Apr 26 after marius-kilocode ping

Recommendation:
- decide: chrarnoldus was asked to re-review Apr 24 but hasn't; before that re-review is useful, a maintainer should confirm Kilo's policy on bundling additional OpenAI-compatible providers.

Notes:
- mergeable=clean and contributor is engaged; if scope is accepted, chrarnoldus can approve quickly.
- PR is 69d old; verify Avian API endpoint is still live.""",
"open","2026-04-26T14:21:33Z","team","2026-04-02T10:22:26Z","clean"),

rec(225,"decide",False,
"""Summary:
- Adds venice.ai as a new AI provider in `packages/opencode/src/provider/` (129 additions, 9 files).

Checks:
- [⚠] Value & approach fit — new third-party provider; scope decision needed
- [✓] Real-behavior proof — bot initially found no issues
- [✓] Bot findings — no CRITICALs at initial scan
- [⚠] Reviewer comments resolved — lambertjosh commented May 7 asking contributor to address items; same-day ask
- [✓] CI & mergeable — mergeable unknown; fresh team engagement
- [⚠] Contributor responsive — team just responded today; waiting_on=contributor

Recommendation:
- decide: New LLM provider integration requires a maintainer scope decision before code review is useful; lambertjosh's May 7 comment surfaces exactly this question.

Notes:
- If scope is accepted, lambertjosh's specific asks should be addressed by contributor before merge.""",
"open","2026-05-07T00:53:12Z","contributor","2026-05-07T00:53:12Z",None),

rec(109,"review",False,
"""Summary:
- Adds a `kilo roll-call` CLI sub-command to batch-test model connectivity across configured providers (456 additions, 3 files).

Checks:
- [✓] Value & approach fit — linked feature request #6304; clear diagnostic utility
- [⚠] Real-behavior proof — no automated test; manual connectivity test is the feature
- [✓] Bot findings — no CRITICALs
- [⚠] Reviewer comments resolved — alex-alecu asked 'Should this merge model.options too?'; contributor acknowledged but hasn't addressed
- [✓] CI & mergeable — mergeable=clean
- [✓] Contributor responsive — replied May 3, johnnyeric re-opened discussion May 4

Recommendation:
- review: alex-alecu's open question about merging `model.options` must be resolved; once answered the diff is small enough for a quick final review.

Notes:
- Previously marked closed by johnnyeric; contributor explained delay; team re-engaged May 4 — not stale.""",
"open","2026-05-04T09:49:59Z","contributor","2026-04-08T12:11:23Z","clean"),

rec(110,"review",False,
"""Summary:
- Fixes mode-specific rules not being filtered by the active agent in `packages/opencode/src/` rule-loading logic (167 additions, 14 deletions, 6 files).

Checks:
- [✓] Value & approach fit — valid bugfix; mode-rule filtering is broken without this
- [⚠] Real-behavior proof — no test; bot WARNING about buildConfig path still dropping rules
- [✗] Bot findings — WARNING: custom mode rules still dropped on injected-config path
- [✗] Reviewer comments resolved — alex-alecu (May 7) raised path-traversal security question: can `/../` in a mode slug escape the workspace?
- [✗] Security/supply-chain — path traversal via custom mode slug unverified
- [✗] CI & mergeable — mergeable=conflict; rebase required
- [✓] Contributor responsive — waiting for contributor to address fresh review (May 7)

Recommendation:
- review: contributor must answer alex-alecu's path-traversal security question (May 7) and resolve the merge conflict before this can progress.

Notes:
- Security concern is concrete: a mode slug with `/../` could escape workspace bounds; contributor must verify sanitization.""",
"open","2026-05-07T08:05:20Z","contributor","2026-05-07T08:05:20Z","conflict"),

rec(47,"close",True,
"""Summary:
- Adds sidebar focus and a delay before posting tasks in the VS Code extension to prevent silent failures (222 additions, 9 files).

Checks:
- [⚠] Value & approach fit — addresses a timing issue but motivation unclear
- [✗] Real-behavior proof — no repro steps; marius-kilocode asked for repro twice (Mar 26, May 4)
- [✓] Bot findings — no CRITICALs
- [✗] Reviewer comments resolved — marius-kilocode asked for repro explanation; contributor's last reply was Mar 26
- [⚠] CI & mergeable — mergeable unknown; no CI signal
- [✗] Contributor responsive — no reply to May 4 team re-ping; last contributor activity Mar 26

Recommendation:
- close (stale_contributor): Team asked for repro steps twice (Mar 26 + May 4) with no follow-through from contributor; silent for >40 days.

Notes:
- If contributor returns with a clear repro, PR is worth re-opening.""",
"open","2026-05-04T10:48:21Z","contributor","2026-03-26T11:50:27Z",None),

rec(17756,"review",False,
"""Summary:
- Fixes MCP migrator ignoring servers that use the `transport` field (VS Code extension format) in `packages/opencode/src/mcp/migrate.ts` (141 additions, 2 files).

Checks:
- [✓] Value & approach fit — clear bug; VS Code extension format not handled in migrator
- [✗] Real-behavior proof — johnnyeric asked for testing details May 4; contributor hasn't responded yet
- [✓] Bot findings — bot found no issues
- [⚠] Reviewer comments resolved — team ask (May 4) is fresh; not yet stale
- [✓] CI & mergeable — mergeable unknown; no CI failures noted
- [⚠] Contributor responsive — PR created Mar 29; team first responded May 4; contributor reply pending

Recommendation:
- review: contributor needs to add testing details as requested May 4; team should verify once provided.

Notes:
- PR is 39d old; team response was delayed but ask is fresh — not yet stale.""",
"open","2026-05-04T11:17:42Z","contributor","2026-05-04T11:17:42Z",None),

rec(23715,"decide",True,
"""Summary:
- Adds FastRouter as a new AI provider in `packages/opencode/src/provider/` (168 additions, 11 files).

Checks:
- [⚠] Value & approach fit — new provider; scope decision needed
- [⚠] Real-behavior proof — contributor notes CI failures are main-branch-wide, not PR-specific
- [✓] Bot findings — no CRITICALs
- [⚠] Reviewer comments resolved — no team response despite chrarnoldus assignment; stale handoff
- [⚠] CI & mergeable — mergeable unknown; CI state unclear
- [✓] Contributor responsive — contributor was active and responsive through Apr 14

Recommendation:
- decide: No team response for 23+ days despite chrarnoldus assignment; maintainer must either accept the new-provider scope or explicitly decline.

Notes:
- PR is 37d old with no first team response; stale team-owned handoff.
- Contributor has been engaged and addressed merge conflicts; deserves a clear answer.""",
"open","2026-04-14T12:35:09Z","team",None,None),

rec(31846,"review",False,
"""Summary:
- Fixes inability to type decimal points in numeric settings fields (temperature, top_p) in the VS Code extension webview (85 additions, 15 deletions, 2 files).

Checks:
- [✓] Value & approach fit — clear UX bug fix; linked to issue #8206
- [⚠] Real-behavior proof — no automated test; fix is UI-level
- [✓] Bot findings — bot found no issues
- [✓] Reviewer comments resolved — no reviewer comments; first review needed
- [✓] CI & mergeable — mergeable=clean
- [⚠] Contributor responsive — no team response for 35d; contributor waiting

Recommendation:
- review: markijbema suggested as reviewer; clean, focused bug fix needs first code review.

Notes:
- PR is 35d old with mergeable=clean and no blocking findings; straightforward review.""",
"open","2026-04-02T16:21:07Z","team",None,"clean"),

rec(31875,"review",False,
"""Summary:
- Handles trailing assistant messages for Claude 4.6 no-prefill models in `packages/opencode/src/provider/` to prevent 'does not support assistant message prefill' errors (245 additions, 2 files).

Checks:
- [✓] Value & approach fit — linked bug #8260 with clear repro; addresses real model constraint
- [⚠] Real-behavior proof — no automated test; fix targets runtime model behavior
- [✗] Bot findings — WARNING: re-roling reasoning parts to `user` produces invalid message shape
- [✓] Reviewer comments resolved — no human reviewer comments yet
- [✓] CI & mergeable — mergeable unknown; no CI failures noted
- [⚠] Contributor responsive — no team response for 34d; contributor waiting

Recommendation:
- review: chrarnoldus suggested as reviewer; bot WARNING about invalid message shape on re-rolled reasoning parts needs human validation before merge.

Notes:
- PR is 34d old; spot-check whether Claude 4.6 prefill behavior has changed on current main before acting.""",
"open","2026-04-03T09:24:04Z","team",None,None),

rec(31876,"review",False,
"""Summary:
- Gates OpenAI Responses API parameters (e.g. `reasoningSummary`) for openai-compatible providers to prevent 'Unknown parameter' errors in `packages/opencode/src/provider/` (101 additions, 10 deletions, 2 files).

Checks:
- [✓] Value & approach fit — linked bug #8261 (1 reaction); concrete openai-compat regression fix
- [⚠] Real-behavior proof — no automated test; fix is provider-routing logic
- [✓] Bot findings — only SUGGESTION (non-blocking id interpolation)
- [✓] Reviewer comments resolved — chrarnoldus approved May 6; asked for conflict fix
- [✗] CI & mergeable — mergeable unknown; chrarnoldus asked contributor to resolve conflicts May 6
- [⚠] Contributor responsive — waiting_on=contributor post-approval; rebase needed

Recommendation:
- review: contributor needs to rebase after chrarnoldus's May 6 approval; once clean it can land.

Notes:
- chrarnoldus already approved — this is one rebase away from merge.""",
"open","2026-05-06T15:12:17Z","contributor","2026-05-06T08:55:05Z",None),

rec(31861,"decide",False,
"""Summary:
- Implements native OS notifications and configurable sound alerts for task completion in the VS Code extension (715 additions, 58 deletions, 117 files).

Checks:
- [⚠] Value & approach fit — linked feature requests #7048 and #7877; large scope, many files
- [⚠] Real-behavior proof — marius-kilocode tested Apr 7; contributor addressed feedback Apr 16
- [✗] Bot findings — WARNING: timestamped key disables dedupe for repeated event broadcasts (unaddressed)
- [⚠] Reviewer comments resolved — marius-kilocode hasn't re-reviewed since Apr 16 update
- [✓] CI & mergeable — mergeable unknown
- [✓] Contributor responsive — contributor active and addressed prior feedback

Recommendation:
- decide: Product/scope call needed on whether OS notifications and sound alerts belong natively in core vs. an extension setting; 117-file diff is large for this feature scope.

Notes:
- Unresolved bot WARNING about dedupe timestamping needs contributor fix if feature is accepted.
- marius-kilocode is assigned; needs to either re-review or escalate the scope question.""",
"open","2026-04-26T04:23:38Z","team","2026-04-07T09:07:53Z",None),

rec(31865,"close",True,
"""Summary:
- Adds CLI parity features, security hardening, hooks, memory management, and multi-agent orchestration across 32 files in a single PR (2 059 additions).

Checks:
- [✗] Value & approach fit — bundles unrelated cross-cutting concerns into one PR
- [✗] Real-behavior proof — no tests; no repro; no screenshots
- [✗] Bot findings — WARNING: max_turns ignored for subagents; WARNING: --allowed-tools leaves MCP tools enabled; WARNING: step.start reports retry not step number
- [✓] Reviewer comments resolved — no human reviewer; no one assigned
- [✓] CI & mergeable — mergeable unknown
- [✗] Contributor responsive — no activity since Apr 3 creation; 34d+ idle

Recommendation:
- close (unreviewable_scope): 2 059-line PR spanning security, hooks, memory, and orchestration across 32 files cannot be reviewed safely as a unit; no team response in 34d.

Notes:
- Contributor is welcome to split into focused, reviewable PRs.""",
"open","2026-04-03T18:49:55Z","team",None,None),

rec(31863,"review",False,
"""Summary:
- Documents the Claude Code Compatibility toggle in `packages/kilo-docs/` (12 additions, 4 deletions, 2 files).

Checks:
- [✓] Value & approach fit — docs-only; addresses a real feature
- [⚠] Real-behavior proof — lambertjosh flagged potential accuracy issues May 5
- [✓] Bot findings — no CRITICALs
- [✗] Reviewer comments resolved — lambertjosh left changes_requested May 5: clarify this is not the 'happy path' and remove recommendation to use toggle
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — waiting_on=contributor; lambertjosh ask is 2 days old

Recommendation:
- review: contributor needs to address lambertjosh's two specific editorial asks from May 5 before this docs PR can land.

Notes:
- lambertjosh both approved AND requested changes on May 5; the changes_requested supersedes the approval.""",
"open","2026-05-05T05:43:06Z","contributor","2026-05-05T05:42:19Z",None),

rec(31862,"close",True,
"""Summary:
- Attempts broad security hardening: path traversal prevention, log sanitization, and code quality across 45 files (2 423 additions).

Checks:
- [✗] Value & approach fit — mixes unrelated concerns; broad unscoped churn across 45 files
- [✗] Real-behavior proof — no tests; no repro for specific vulnerabilities addressed
- [✗] Bot findings — CRITICAL: protected config edits auto-approved in allow_edits mode; WARNING: flags evaluated too early; WARNING: async_rewake runs hook twice
- [✓] Reviewer comments resolved — no human reviewer assigned
- [✗] Security/supply-chain — CRITICAL bot finding about protected-config auto-approval unaddressed
- [✗] CI & mergeable — mergeable=conflict; no contributor fix for 34d+
- [✗] Contributor responsive — no activity since Apr 3; 34d+ idle with conflict

Recommendation:
- close (unreviewable_scope): 2 423-line PR across 45 files with an unaddressed CRITICAL security finding and a stale merge conflict cannot be reviewed safely.

Notes:
- The CRITICAL about auto-approving protected config edits is a real security concern; if valid, it should be raised as a standalone focused PR.""",
"open","2026-04-03T20:56:18Z","team",None,"conflict"),

rec(31858,"review",False,
"""Summary:
- Adds a turn completion indicator and elapsed duration display to the VS Code extension chat UI (104 additions, 22 files).

Checks:
- [✓] Value & approach fit — linked issue #7884; clear UX improvement request
- [⚠] Real-behavior proof — no screenshot; no automated test
- [✓] Bot findings — bot found no issues
- [✓] Reviewer comments resolved — no human reviewer comments; markijbema assigned
- [⚠] CI & mergeable — mergeable unknown; owner_sla=breached
- [⚠] Contributor responsive — no team response for 33d; contributor waiting

Recommendation:
- review: markijbema is the assigned reviewer; needs first code review with a screenshot request to verify indicator appearance.

Notes:
- 22 changed files for 104 additions is broad; reviewer should confirm no unintended side-effects on other UI states.""",
"open","2026-04-04T01:24:08Z","team",None,None),

rec(31833,"decide",False,
"""Summary:
- Adds `{file:...}` syntax to agent markdown prompt config so external file contents can be inlined at load time in `packages/opencode/src/config/` (230 additions, 4 files).

Checks:
- [⚠] Value & approach fit — new config syntax; product/scope call needed on whether to expose this
- [✓] Real-behavior proof — contributor addressed JSON-escaping bot WARNING in commit 69de5c5
- [✓] Bot findings — WARNING addressed; bot noted no remaining issues after fix
- [✓] Reviewer comments resolved — no human reviewer comments yet
- [⚠] Security/supply-chain — file inclusion in config could read sensitive paths; no sandbox check present
- [✓] CI & mergeable — mergeable unknown; no CI issues
- [⚠] Contributor responsive — no team response for 33d

Recommendation:
- decide: New config-level file-inclusion syntax needs a maintainer decision on scope and security bounds (what paths should `{file:...}` be allowed to read?).

Notes:
- Security surface: arbitrary file inclusion in config context should be sandboxed to workspace root.""",
"open","2026-04-04T20:16:32Z","team",None,None),

rec(31835,"decide",False,
"""Summary:
- Adds Hindi (`hi`) locale files to `packages/kilo-i18n/` (632 additions, 9 files).

Checks:
- [⚠] Value & approach fit — new locale; needs scope/acceptance decision
- [✓] Real-behavior proof — contributor registered `hi` end-to-end and addressed fallback WARNING
- [✓] Bot findings — WARNING about English fallback addressed in follow-up commit
- [✓] Reviewer comments resolved — no human reviewer comments; catrielmuller suggested as reviewer
- [✓] CI & mergeable — mergeable unknown; no CI failures noted
- [✓] Contributor responsive — active through Apr 25; asked good questions about i18n contribution process

Recommendation:
- decide: New locale addition requires a maintainer scope decision on which locales are accepted and the quality bar for completeness.

Notes:
- catrielmuller is the i18n suggested reviewer; should own this decision.
- Contributor is engaged and proactively addressed bot feedback.""",
"open","2026-04-25T06:34:52Z","team",None,None),

rec(31825,"review",False,
"""Summary:
- Accepts `env` as an alias for `environment` in local MCP server config in `packages/opencode/src/mcp/` (69 additions, 16 deletions, 2 files).

Checks:
- [✓] Value & approach fit — fixes a real config compatibility issue (#8288); focused change
- [✓] Real-behavior proof — bot found no issues; small targeted fix
- [✓] Bot findings — no issues found
- [⚠] Reviewer comments resolved — imanolmzd-svg assigned Apr 8 but has not reviewed; stale handoff
- [✓] CI & mergeable — mergeable=clean
- [⚠] Contributor responsive — last activity Apr 8 (team routing); no contributor-directed ask was made

Recommendation:
- review: imanolmzd-svg is the assigned reviewer and has not acted; clean focused fix waiting 29d for first review.

Notes:
- PR is 31d old with mergeable=clean; waiting_on=contributor on dashboard appears incorrect — the routing on Apr 8 was maintainer-to-maintainer.""",
"open","2026-04-08T13:56:00Z","contributor","2026-04-08T13:56:00Z","clean"),

rec(32622,"review",False,
"""Summary:
- Adds support for additional image upload formats (bmp, tiff, svg, ico) in the VS Code extension drag-and-drop handler (80 additions, 33 deletions, 7 files).

Checks:
- [✓] Value & approach fit — linked bug #8283; real user-reported upload failure
- [⚠] Real-behavior proof — contributor claims fix applied Apr 14; marius-kilocode hasn't re-tested
- [✗] Bot findings — CRITICAL: removing `ACCEPTED_IMAGE_TYPES` breaks webview build; contributor claims fixed Apr 14
- [⚠] Reviewer comments resolved — marius-kilocode found ico/svg not working Apr 8; contributor says fixed
- [⚠] CI & mergeable — mergeable unknown; no re-test after fix
- [✓] Contributor responsive — contributor fixed reported issues Apr 14

Recommendation:
- review: team needs to re-test ico/svg drag-and-drop after contributor's Apr 14 fix and verify the CRITICAL about `ACCEPTED_IMAGE_TYPES` removal is resolved.

Notes:
- No reviewer currently assigned; markijbema is the suggested reviewer.""",
"open","2026-04-14T09:35:35Z","team","2026-04-08T14:01:08Z",None),

rec(33204,"review",False,
"""Summary:
- Docs update for v7.2.1 features across 4 files in `packages/kilo-docs/` (5 additions).

Checks:
- [⚠] Value & approach fit — docs-only XS; content accuracy at 29d old uncertain
- [⚠] Real-behavior proof — no human verified content is still accurate
- [✓] Bot findings — no issues found
- [⚠] Reviewer comments resolved — lambertjosh assigned Apr 21 but has not reviewed; owner_sla=breached
- [⚠] CI & mergeable — mergeable unknown; Vercel deployment gated on team approval
- [⚠] Contributor responsive — no activity needed from contributor; team is the blocker

Recommendation:
- review: lambertjosh should do a quick content-accuracy check on the v7.2.1 feature descriptions before merging.

Notes:
- PR is 29d old; spot-check that v7.2.1 feature docs still reflect current main behavior.""",
"open","2026-04-08T19:34:04Z","team",None,None),

rec(34095,"review",False,
"""Summary:
- Improves TUI patch-apply output to visually indicate when skipped sections exist in `packages/opencode/src/` diff rendering (280 additions, 59 deletions, 5 files).

Checks:
- [✓] Value & approach fit — linked UX issue #7861; addresses real diff confusion
- [⚠] Real-behavior proof — no automated test; contributor self-tested
- [⚠] Bot findings — WARNING: file boundary detection can split inside a hunk; contributor marked 'Fixed' Apr 15
- [✓] Reviewer comments resolved — contributor addressed bot WARNING
- [⚠] CI & mergeable — mergeable unknown; imanolmzd-svg assigned but no review
- [✓] Contributor responsive — contributor addressed bot feedback Apr 15

Recommendation:
- review: imanolmzd-svg is the assigned reviewer and needs to do first human review after contributor's Apr 15 fix.

Notes:
- Bot WARNING about hunk-splitting edge case: reviewer should verify the boundary detection fix is robust.""",
"open","2026-04-15T17:39:21Z","team",None,None),

rec(34091,"decide",False,
"""Summary:
- Adds Kyma API as a new built-in provider in `packages/opencode/src/provider/` (154 additions, 26 deletions, 3 files).

Checks:
- [⚠] Value & approach fit — new provider; scope decision needed
- [⚠] Real-behavior proof — no proof the provider endpoint is production-ready
- [✗] Bot findings — WARNING: Kyma models permanently stale after first lookup; WARNING: built-in providers disappear from normal login flow before auth
- [✓] Reviewer comments resolved — no human reviewer assigned
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 26d; contributor waiting

Recommendation:
- decide: New provider scope call needed; two unaddressed bot WARNINGs (stale model list, broken login flow) are blockers if scope is accepted.

Notes:
- chrarnoldus is the suggested reviewer; should own the scope + implementation decision.""",
"open","2026-04-11T01:37:19Z","team",None,None),

rec(34085,"review",False,
"""Summary:
- Reduces VS Code extension webview renderer memory accumulation to prevent OOM grey-screen in `packages/kilo-vscode/webview-ui/` (311 additions, 73 deletions, 30 files).

Checks:
- [✓] Value & approach fit — linked issue #8607; real OOM risk addressed
- [⚠] Real-behavior proof — contributor rebased and pushed updates May 7; no automated test
- [✗] Bot findings — WARNING (May 6): leading assistant messages disappear from history in new implementation
- [⚠] Reviewer comments resolved — marius-kilocode has not re-reviewed after contributor's May 7 rebase
- [⚠] CI & mergeable — mergeable unknown; contributor rebased today
- [✓] Contributor responsive — active; pushed updates May 7 addressing feedback

Recommendation:
- review: marius-kilocode needs to re-review after contributor's May 7 rebase; bot WARNING about lost leading assistant messages must be validated.

Notes:
- This PR has been iterated significantly; the memory fix is valuable but the message-history regression WARNING is a blocking concern.""",
"open","2026-05-07T00:10:08Z","team","2026-04-14T13:41:47Z",None),

rec(34090,"review",False,
"""Summary:
- Deduplicates `solid-js` and `@opentui/solid` in `bun.lock` to fix 'No renderer found' TUI startup crash (7 additions, 31 deletions, 3 files).

Checks:
- [✓] Value & approach fit — linked issue #8760 (6 reactions); real crash fix
- [⚠] Real-behavior proof — no automated test; fix is lockfile dedup
- [✓] Bot findings — no issues found
- [⚠] Reviewer comments resolved — markijbema assigned but no review; owner_sla=at_risk
- [⚠] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 26d; contributor waiting

Recommendation:
- review: markijbema needs to verify the solid-js dedup still resolves the crash on current main before merging.

Notes:
- PR is 26d old; spot-check current main bun.lock for whether solid-js duplication already resolved upstream.""",
"open","2026-04-11T03:36:03Z","team",None,None),

rec(34305,"review",False,
"""Summary:
- Makes `kilo.json` take priority over `opencode.json` during config loading in `packages/opencode/src/config/` (109 additions, 4 deletions, 2 files).

Checks:
- [✓] Value & approach fit — linked issue #7621; clear intent for Kilo-specific config precedence
- [⚠] Real-behavior proof — bot noted 1 issue; no automated test
- [⚠] Bot findings — bot summary says 1 issue found; specific finding not available in list data
- [✓] Reviewer comments resolved — no human reviewer comments; alex-alecu suggested
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 26d; contributor waiting

Recommendation:
- review: alex-alecu should review the config-priority logic and validate the bot finding before merge.

Notes:
- The bot finding detail is not visible in list data; reviewer should check the full bot comment on the PR.""",
"open","2026-04-11T17:30:06Z","team",None,None),

rec(34298,"review",False,
"""Summary:
- Fixes 'Add to Context' silently doing nothing in certain conditions in the VS Code extension (`packages/kilo-vscode/src/`) (88 additions, 41 deletions, 3 files).

Checks:
- [✓] Value & approach fit — linked issues #8443 (2 reactions), #8592; multiple user reports
- [⚠] Real-behavior proof — no automated test; no screenshot; fix is event-handler logic
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer comments; markijbema assigned
- [⚠] CI & mergeable — mergeable unknown; owner_sla=at_risk
- [⚠] Contributor responsive — no team response for 26d; contributor waiting

Recommendation:
- review: markijbema is the assigned reviewer; clean focused bug fix needs first code review and manual verification of the 'Add to Context' flow.

Notes:
- Contributor notes this also fixes #8592 and #7858; reviewer should verify coverage of all three issues.""",
"open","2026-04-11T21:05:04Z","team",None,None),

rec(34292,"review",False,
"""Summary:
- Adds an image attachment path mode setting for MCP file path handling in the VS Code extension (199 additions, 16 deletions, 7 files).

Checks:
- [⚠] Value & approach fit — addresses MCP file path handling; scope not trivial
- [⚠] Real-behavior proof — no screenshot; no automated test
- [✗] Bot findings — WARNING: `onDidChangeConfiguration` listener never disposed (memory leak)
- [⚠] Reviewer comments resolved — contributor acknowledged the listener leak; not yet fixed
- [⚠] CI & mergeable — mergeable unknown; no team response
- [⚠] Contributor responsive — contributor self-identified the leak issue; hasn't fixed it

Recommendation:
- review: contributor must fix the `onDidChangeConfiguration` listener leak they acknowledged before this can be reviewed; no team reviewer assigned yet.

Notes:
- markijbema is suggested as reviewer; assign after contributor fixes the leak.""",
"open","2026-04-13T03:46:19Z","team",None,None),

rec(34278,"close",True,
"""Summary:
- Adds multi-provider speech synthesis for AI responses across 366 changed files (61 135 additions, 139 deletions).

Checks:
- [✗] Value & approach fit — massive diff (366 files, 61k additions) makes review impossible
- [✗] Real-behavior proof — no tests; no demo recording
- [✗] Bot findings — multiple WARNINGs: audit log returns wrong type; duplicate event listeners leak; audit weighting mismatch; new servers always emitted as updates
- [✓] Reviewer comments resolved — no human reviewer assigned
- [✗] Security/supply-chain — 61k lines including unreviewed generated/vendor content
- [⚠] CI & mergeable — mergeable unknown
- [✗] Contributor responsive — no contributor activity since Apr 19 bot review

Recommendation:
- close (unreviewable_scope): 61 135 additions across 366 files is not reviewable as a single PR regardless of feature merit.

Notes:
- If contributor wants to pursue speech synthesis, a minimal focused implementation without generated/vendor noise is required.""",
"open","2026-04-19T01:07:52Z","team",None,None),

rec(34772,"decide",False,
"""Summary:
- Adds `MiniMax-AI/cli` as a default built-in skill tap in `packages/opencode/src/skills/` (438 additions, 2 files).

Checks:
- [⚠] Value & approach fit — adding a third-party CLI tool as a default skill is a significant scope call
- [✗] Real-behavior proof — no test; no usage demo
- [✗] Bot findings — WARNING: entry never registered in BUILTIN_SKILLS; WARNING: conflicting video download flags
- [✓] Reviewer comments resolved — no human reviewer assigned
- [⚠] Security/supply-chain — adding an external CLI as a default skill tap creates supply-chain exposure
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 24d

Recommendation:
- decide: Bundling an external third-party CLI (`MiniMax-AI/cli`) as a default skill is a product and supply-chain ownership decision; two bot WARNINGs also indicate the implementation is incomplete.

Notes:
- alex-alecu is suggested reviewer; should evaluate security implications of default third-party skill taps.""",
"open","2026-04-13T18:00:41Z","team",None,None),

rec(34771,"review",False,
"""Summary:
- Docs update clarifying Discord is unavailable for new KiloClaw installs in `packages/kilo-docs/` (35 additions, 51 deletions, 3 files).

Checks:
- [⚠] Value & approach fit — 'KiloClaw' terminology needs verification for accuracy
- [⚠] Real-behavior proof — no human confirmed this is still accurate at 24d old
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer assigned
- [⚠] CI & mergeable — mergeable unknown; lambertjosh suggested reviewer
- [⚠] Contributor responsive — no team response for 24d

Recommendation:
- review: lambertjosh should verify 'KiloClaw' terminology is correct and the Discord availability statement still matches current onboarding before merging.

Notes:
- PR is 24d old; content accuracy spot-check is the only blocker.""",
"open","2026-04-13T19:34:21Z","team",None,None),

rec(35120,"review",False,
"""Summary:
- Fixes the Grep tool displaying an incorrect path in the VS Code extension search results (71 additions, 47 deletions, 9 files).

Checks:
- [✓] Value & approach fit — linked bug #8881; real path display error
- [✗] Real-behavior proof — team asked for screenshot Apr 14; third party clarified Apr 24; contributor never followed up with screenshot
- [✓] Bot findings — no issues found
- [⚠] Reviewer comments resolved — screenshot request still pending from contributor
- [⚠] CI & mergeable — mergeable unknown; no team re-engagement after Apr 24 clarification
- [⚠] Contributor responsive — last contributor activity Apr 14; third party clarified Apr 24 but contributor hasn't responded

Recommendation:
- review: team should explicitly re-ping contributor to provide the path-display screenshot now that the ask has been clarified (Apr 24).

Notes:
- Ball is in contributor's court but dashboard shows waiting_on=team; team should formally ping contributor for the screenshot.""",
"open","2026-04-24T13:54:16Z","team","2026-04-14T15:11:45Z",None),

rec(35111,"decide",False,
"""Summary:
- Adds HPC-AI (High Performance Computing AI) as a new model provider in `packages/opencode/src/provider/` (265 additions, 10 files).

Checks:
- [⚠] Value & approach fit — new provider; scope decision needed
- [✗] Real-behavior proof — no evidence of working API integration
- [✓] Bot findings — copilot review only; no CRITICALs
- [✓] Reviewer comments resolved — no human reviewer assigned
- [⚠] CI & mergeable — mergeable unknown; no team response at all
- [⚠] Contributor responsive — no team response for 22d

Recommendation:
- decide: New provider integration requires a maintainer scope decision; no reviewer assigned in 22d.

Notes:
- Reviewer suggested: chrarnoldus for provider integrations.""",
"open","2026-04-15T08:33:23Z","team",None,None),

rec(36702,"review",False,
"""Summary:
- Adds eager warmup of the tool registry and MCP on CLI bootstrap to reduce ~2.5s cold start (12 additions, 2 files).

Checks:
- [⚠] Value & approach fit — linked issue #7946; but marius-kilocode questioned if warmup is the real cause
- [✗] Real-behavior proof — no profiling data or benchmark showing warmup is the bottleneck
- [✗] Bot findings — WARNING: fire-and-forget warmup can surface unhandled rejections; WARNING: warmup triggers MCP startup side-effects during bootstrap
- [⚠] Reviewer comments resolved — marius-kilocode asked 'not sure if that is the real issue' May 5; contributor hasn't provided evidence
- [✓] CI & mergeable — mergeable unknown; small change
- [⚠] Contributor responsive — waiting_on=contributor; team doubt expressed May 5

Recommendation:
- review: contributor needs to provide profiling evidence that tool-registry warmup is the actual source of the ~2.5s cold start before team invests in full review.

Notes:
- Two bot WARNINGs (unhandled rejections, MCP side-effects at bootstrap) must also be addressed if the diagnosis is confirmed.""",
"open","2026-05-05T22:15:15Z","contributor","2026-05-05T22:15:15Z",None),

rec(36954,"review",False,
"""Summary:
- Docs additions for custom commit message prompt, CLI config path, and GitLab fork MRs in `packages/kilo-docs/` (24 additions, 3 files).

Checks:
- [⚠] Value & approach fit — docs-only; useful additions but accuracy uncertain
- [⚠] Real-behavior proof — bot WARNING notes config path still references legacy filenames
- [✗] Bot findings — WARNING: project config path still points to legacy filenames (`kilo.json` not shown correctly)
- [⚠] Reviewer comments resolved — lambertjosh assigned Apr 21 but has not reviewed; owner_sla=breached
- [⚠] CI & mergeable — mergeable unknown; Vercel gated
- [⚠] Contributor responsive — no team response for 22d

Recommendation:
- review: lambertjosh should verify the config path description is current and fix the bot-flagged legacy filename reference before merging.

Notes:
- PR is 22d old; the bot WARNING about legacy config filenames is a content-accuracy blocker.""",
"open","2026-04-15T19:39:12Z","team",None,None),

rec(36712,"review",False,
"""Summary:
- Makes the Write tool card expandable and adds an overwrite indicator in the TUI/UI (83 additions, 29 deletions, 2 files).

Checks:
- [✓] Value & approach fit — linked issue #9053 (1 reaction); clear UX improvement
- [⚠] Real-behavior proof — no screenshot; bot WARNING about created-write indicator missing
- [✗] Bot findings — WARNING: created writes still have no collapsed-card indicator (only overwrite handled)
- [⚠] Reviewer comments resolved — imanolmzd-svg assigned but has not reviewed
- [⚠] CI & mergeable — mergeable unknown; owner_sla=at_risk
- [⚠] Contributor responsive — no team response for 21d; contributor waiting

Recommendation:
- review: imanolmzd-svg needs to review and verify whether the bot WARNING about missing created-write indicator was addressed or is still outstanding.

Notes:
- Reviewer should request a screenshot showing both overwrite and new-file cases.""",
"open","2026-04-16T16:33:58Z","team",None,None),

rec(36705,"close",True,
"""Summary:
- Adds an optional `variant` parameter to the `new_task` tool to enable per-subtask reasoning levels in `packages/opencode/src/` (316 additions, 14 deletions, 5 files).

Checks:
- [⚠] Value & approach fit — linked feature request #9145 (1 reaction); reasonable feature
- [✗] Real-behavior proof — no test; CRITICAL prevents compilation
- [✗] Bot findings — CRITICAL: duplicate `msg`/`model` declarations break TypeScript compilation
- [✓] Reviewer comments resolved — no human reviewer assigned
- [✗] CI & mergeable — code does not compile as submitted; mergeable unknown
- [✗] Contributor responsive — CRITICAL raised Apr 19; contributor has not responded in 18d

Recommendation:
- close (unaddressed_critical): Bot-found CRITICAL (duplicate declarations breaking compilation) has gone unaddressed for 18 days with no contributor response.

Notes:
- Contributor is welcome to re-open after fixing the compilation error.""",
"open","2026-04-19T13:08:19Z","team",None,None),

rec(36682,"review",False,
"""Summary:
- Adds issue template requirements and fixes broken anchor links in `CONTRIBUTING.md` (31 additions, 3 deletions, 1 file).

Checks:
- [✓] Value & approach fit — linked issue #6115; addresses agent-created issues being auto-closed
- [✓] Real-behavior proof — contributor addressed bot feedback and self-verified fix
- [✓] Bot findings — no issues found after contributor's fix
- [⚠] Reviewer comments resolved — lambertjosh assigned; Vercel CI gated on team approval
- [⚠] CI & mergeable — mergeable unknown; Vercel preview requires team action
- [✓] Contributor responsive — contributor fixed feedback and provided context

Recommendation:
- review: lambertjosh should approve and unblock the Vercel CI gating; small docs fix with all feedback addressed.

Notes:
- Only blocker is Vercel team-gated CI; the content change is clean.""",
"open","2026-04-21T16:11:29Z","team",None,None),

rec(36674,"review",False,
"""Summary:
- Adds free and budget model recommendations to the model selection guide in `packages/kilo-docs/` (39 additions, 1 deletion, 1 file).

Checks:
- [⚠] Value & approach fit — useful docs addition; accuracy of free-tier claims needs verification
- [⚠] Real-behavior proof — bot WARNING about free-tier status; contributor clarified in ef28e81
- [⚠] Bot findings — WARNING: one listed model not free in current Kilo catalog; contributor addressed
- [✓] Reviewer comments resolved — contributor self-addressed bot feedback
- [⚠] CI & mergeable — mergeable unknown; Vercel gated on team approval
- [✓] Contributor responsive — contributor proactively addressed bot WARNING

Recommendation:
- review: lambertjosh should verify the free/budget model claims are accurate against current Kilo catalog before merging.

Notes:
- Model pricing changes frequently; reviewer should spot-check the NVIDIA Nemotron entry specifically flagged by the bot.""",
"open","2026-04-21T16:11:30Z","team",None,None),

rec(39349,"review",False,
"""Summary:
- Adds a YOLO/auto-approve mode to CLI and TUI sessions that bypasses permission prompts (463 additions, 94 deletions, 13 files).

Checks:
- [✓] Value & approach fit — high demand feature; marius-kilocode confirmed direction May 5 (rename to --auto-approve)
- [⚠] Real-behavior proof — no automated test for permission-bypass behavior
- [✓] Bot findings — no CRITICALs
- [✗] Reviewer comments resolved — alex-alecu left two unresolved questions Apr 23: 'Can consume() burn the flag?' and 'Should seen ever get cleared?'
- [⚠] Security/supply-chain — permission bypass is security-sensitive; requires careful review
- [⚠] CI & mergeable — mergeable unknown; contributor_sla=healthy
- [✓] Contributor responsive — contributor_sla=healthy

Recommendation:
- review: contributor needs to address alex-alecu's two flag-lifecycle questions and rename to `--auto-approve` per marius-kilocode's May 5 direction.

Notes:
- Security surface: auto-approve mode; reviewer must verify the flag cannot leak across sessions.""",
"open","2026-05-05T21:24:49Z","contributor","2026-04-23T14:59:33Z",None),

rec(39648,"review",False,
"""Summary:
- Improves the guidelines prompt for `kilo agent create` in `packages/opencode/src/` (7 additions, 23 deletions, 1 file).

Checks:
- [✓] Value & approach fit — small prompt quality improvement; no scope concern
- [✓] Real-behavior proof — contributor clarified formatting question
- [✓] Bot findings — no issues found
- [⚠] Reviewer comments resolved — marius-kilocode asked about formatting risk Apr 23; contributor explained it is fine; marius hasn't re-reviewed
- [✓] CI & mergeable — mergeable unknown; small change
- [✓] Contributor responsive — responded promptly to reviewer concern

Recommendation:
- review: marius-kilocode needs to confirm acceptance of contributor's formatting explanation and re-approve.

Notes:
- Very small change (7 adds, 23 deletes, 1 file); quick re-review should suffice.""",
"open","2026-04-23T14:42:53Z","team","2026-04-23T14:23:23Z",None),

rec(40917,"decide",False,
"""Summary:
- Adds support for custom FIM (fill-in-the-middle) providers in the autocomplete subsystem in `packages/kilo-vscode/` (259 additions, 45 deletions, 7 files).

Checks:
- [✓] Value & approach fit — linked issue #6796 (2 reactions); user demand for non-Codestral FIM providers
- [⚠] Real-behavior proof — no test; no demo showing custom FIM working
- [✗] Bot findings — WARNING: custom FIM requests never use the documented default model
- [⚠] Reviewer comments resolved — markijbema assigned but has not reviewed
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 12d

Recommendation:
- decide: Scope call needed on whether custom FIM provider configuration belongs in core autocomplete settings; bot WARNING about default model must be addressed if accepted.

Notes:
- markijbema is assigned; needs to decide scope and then review implementation.""",
"open","2026-04-25T01:51:24Z","team",None,None),

rec(40910,"review",False,
"""Summary:
- Fixes `WorktreeFamily.list` to include the working tree when inside a git submodule in `packages/opencode/src/worktree/` (52 additions, 3 files).

Checks:
- [✓] Value & approach fit — linked issue #9267; real bug with git submodules
- [✓] Real-behavior proof — bot found no issues; focused targeted fix
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer comments; alex-alecu assigned
- [⚠] CI & mergeable — mergeable unknown; owner_sla=at_risk
- [⚠] Contributor responsive — no team response for 12d; contributor waiting

Recommendation:
- review: alex-alecu is the assigned reviewer; clean focused fix needs first code review.

Notes:
- Small targeted fix (52 additions, 3 files); straightforward review.""",
"open","2026-04-25T15:20:39Z","team",None,None),

rec(40907,"review",False,
"""Summary:
- Adds a toggle to enable/disable editing of rules and skills in the VS Code extension settings UI (404 additions, 18 deletions, 9 files).

Checks:
- [⚠] Value & approach fit — useful settings toggle; scope reasonable
- [✗] Real-behavior proof — johnnyeric asked for screenshots May 4; contributor acknowledged build issues same day
- [⚠] Bot findings — various contributor self-review warnings noted
- [⚠] Reviewer comments resolved — screenshots and build fix pending from contributor (May 4)
- [⚠] CI & mergeable — contributor reported build issues; no fix pushed yet
- [✓] Contributor responsive — contributor acknowledged issues and is working on them

Recommendation:
- review: team should wait for contributor to push the build fix and screenshots (acknowledged May 4) before full review.

Notes:
- Contributor actively working; give a few days before following up.""",
"open","2026-05-04T13:49:25Z","team","2026-05-04T10:18:41Z",None),

rec(40901,"decide",False,
"""Summary:
- Adds custom autocomplete provider configuration to VS Code extension settings (699 additions, 100 deletions, 16 files).

Checks:
- [⚠] Value & approach fit — overlaps in scope with PR #9488 (custom FIM providers)
- [⚠] Real-behavior proof — third-party tester noted UI works but CLI integration doesn't
- [✓] Bot findings — no CRITICALs reported
- [⚠] Reviewer comments resolved — markijbema assigned but has not reviewed
- [✗] CI & mergeable — mergeable=conflict; no contributor rebase
- [⚠] Contributor responsive — last contributor activity Apr 27; conflict unresolved

Recommendation:
- decide: Scope call needed to choose between this PR and #9488 (overlapping custom autocomplete provider scope); both need a maintainer decision before reviewing either.

Notes:
- If this PR is accepted, contributor must rebase and resolve the merge conflict.
- markijbema should evaluate both #9488 and #9522 together.""",
"open","2026-04-27T09:21:53Z","team",None,"conflict"),

rec(40895,"decide",False,
"""Summary:
- Adds Cloudflare Workers AI and Cloudflare AI Gateway provider documentation pages and unifies the `CLOUDFLARE_API_TOKEN` env var in `packages/kilo-docs/` (265 additions, 3 files).

Checks:
- [⚠] Value & approach fit — docs describe a feature that may not yet be merged from upstream
- [✗] Real-behavior proof — jrf0110 tested and found instructions don't work; underlying feature possibly not merged yet
- [✗] Bot findings — no bot CRITICALs, but reviewer found instructions incorrect at runtime
- [⚠] Reviewer comments resolved — jrf0110 left review notes Apr 28; contributor_sla=healthy but team needs to act first
- [✓] CI & mergeable — mergeable unknown
- [✓] Contributor responsive — contributor_sla=healthy

Recommendation:
- decide: Team must first determine if the Cloudflare provider upstream behavior has been merged into Kilo before docs can land; jrf0110 noted 'it might be we haven't merged the behavior from opencode upstream yet'.

Notes:
- jrf0110's comment is a team investigation task, not a contributor fix; team needs to check upstream merge status.""",
"open","2026-04-28T01:29:23Z","contributor","2026-04-28T01:20:01Z",None),

rec(41095,"review",False,
"""Summary:
- Adds dynamic model list loading from a running LM Studio instance in `packages/opencode/src/provider/` (149 additions, 39 deletions, 3 files).

Checks:
- [✓] Value & approach fit — LM Studio is a popular local inference tool; dynamic model list is useful
- [⚠] Real-behavior proof — contributor acknowledged sloppy implementation Apr 28; no automated test
- [✗] Bot findings — WARNING: refactor removes the Apertis API-key guard
- [⚠] Reviewer comments resolved — marius-kilocode reviewed Apr 27; contributor responded Apr 28; marius hasn't followed up
- [✓] CI & mergeable — mergeable unknown
- [✓] Contributor responsive — responsive; acknowledged issues Apr 28

Recommendation:
- review: marius-kilocode needs to re-review after contributor's Apr 28 response; bot WARNING about removed API-key guard needs explicit verification.

Notes:
- Contributor self-described the implementation as 'a bit sloppy'; reviewer should validate the API-key guard removal is intentional and safe.""",
"open","2026-04-29T07:12:36Z","team","2026-04-27T13:37:37Z",None),

rec(41331,"review",False,
"""Summary:
- Extracts the PR CLI resolver into a Kilo-specific path in `packages/opencode/src/kilocode/` (23 additions, 22 deletions, 3 files).

Checks:
- [✓] Value & approach fit — reduces upstream merge surface; aligns with kilocode separation strategy
- [✓] Real-behavior proof — small refactor; bot found no issues
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — markijbema approved May 5
- [⚠] CI & mergeable — mergeable unknown; verify before landing
- [✓] Contributor responsive — contributor_sla=healthy; responsive throughout

Recommendation:
- review: markijbema has approved; verify mergeable state is clean then land.

Notes:
- Only blocker is confirming mergeability; team should check and merge promptly given approval.""",
"open","2026-05-05T19:20:41Z","contributor","2026-05-05T19:20:41Z",None),

rec(41329,"review",False,
"""Summary:
- Adds a `/rules` slash command to the CLI that lists loaded rule files for the current session (274 additions, 9 files).

Checks:
- [✓] Value & approach fit — linked feature request #6903; clear debugging utility
- [⚠] Real-behavior proof — no automated test; bot found no issues
- [✓] Bot findings — no issues found
- [⚠] Reviewer comments resolved — alex-alecu asked May 6: 'Should this also include instruction paths already loaded from current session messages?'; contributor hasn't responded yet
- [✓] CI & mergeable — mergeable unknown; contributor_sla=healthy
- [✓] Contributor responsive — contributor_sla=healthy

Recommendation:
- review: contributor needs to address alex-alecu's scope question (May 6) about whether session-loaded instructions should also appear in `/rules` output.

Notes:
- alex's question is a meaningful UX scope question; contributor's answer will determine if a follow-up commit is needed.""",
"open","2026-05-06T11:56:51Z","contributor","2026-05-06T11:56:51Z",None),

rec(41325,"review",False,
"""Summary:
- Removes legacy `.kilocode` migration helpers and updates docs across 14 files (52 additions, 278 deletions).

Checks:
- [⚠] Value & approach fit — cleanup PR for migration helpers; linked issue #6986
- [✗] Real-behavior proof — bot found 3 WARNINGs including stale unit tests asserting removed behavior
- [✗] Bot findings — WARNING: homepage example creates unloaded rules file; WARNING: stale unit tests assert removed WorktreeManager behavior; WARNING: stale path-rewriting tests
- [✓] Reviewer comments resolved — no human reviewer yet; bot findings not addressed by contributor
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 9d; contributor waiting

Recommendation:
- review: team needs to review; contributor should address the 3 bot WARNINGs about stale tests and incorrect homepage examples before this can land.

Notes:
- lambertjosh is suggested reviewer; stale unit test WARNINGs suggest tests will fail — contributor must update them.""",
"open","2026-04-28T04:07:14Z","team",None,None),

rec(41314,"decide",False,
"""Summary:
- Adds background subagent support to the CLI and TUI with a `--background` flag and parallel execution (988 additions, 629 deletions, 24 files).

Checks:
- [⚠] Value & approach fit — linked feature #9611; marius-kilocode engaged with architectural guidance May 5
- [✗] Real-behavior proof — CRITICAL bot finding prevents proper operation
- [✗] Bot findings — CRITICAL (May 6): background mode remains enabled for `kilo run` when flag is set
- [⚠] Reviewer comments resolved — marius-kilocode provided architecture direction May 5; contributor hasn't restructured yet
- [⚠] CI & mergeable — mergeable unknown; large diff (1617 net lines)
- [✓] Contributor responsive — contributor is active

Recommendation:
- decide: marius-kilocode has given architectural direction (split backend/CLI concerns); team should formally agree on the design before contributor restructures the large diff.

Notes:
- CRITICAL about `kilo run` always enabling background mode is a hard blocker regardless of architecture decision.
- marius's comment: 'We probably don't need full feature parity' — team should define the minimal accepted scope.""",
"open","2026-05-06T14:12:30Z","team","2026-05-05T21:52:46Z",None),

rec(42520,"review",False,
"""Summary:
- Adds LLM loop detection for repeated messages, tool calls, and reasoning in `packages/opencode/src/session/` (277 additions, 35 deletions, 2 files).

Checks:
- [✓] Value & approach fit — loop detection is a valuable reliability improvement
- [⚠] Real-behavior proof — no automated test for loop scenarios
- [⚠] Bot findings — WARNING: missing `kilocode_change` marker on shared opencode source file
- [⚠] Reviewer comments resolved — no human reviewer; contributor needs to add kilocode_change markers
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 9d

Recommendation:
- review: contributor must add `kilocode_change` markers per bot WARNING before team review; alex-alecu is suggested reviewer.

Notes:
- The kilocode_change annotation is a CI-enforced requirement; PR will fail the `check-opencode-annotations` workflow without it.""",
"open","2026-04-28T23:27:50Z","team",None,None),

rec(42517,"review",False,
"""Summary:
- Fixes `--raw` CLI atoms being modified rather than passed verbatim in `packages/opencode/src/cli/` (51 additions, 3 files), linked to issue #9622.

Checks:
- [✓] Value & approach fit — targeted bug fix for a documented regression
- [⚠] Real-behavior proof — test file added; bot flagged annotation warnings
- [✗] Bot findings — WARNING: 3x missing `kilocode_change` annotations on shared opencode files/tests
- [⚠] Reviewer comments resolved — no human reviewer; bot annotations must be added
- [✓] CI & mergeable — mergeable unknown; small focused fix
- [⚠] Contributor responsive — no team response for 8d

Recommendation:
- review: contributor must add `kilocode_change` annotations on the 3 shared files flagged by bot (CI requirement); alex-alecu suggested reviewer.

Notes:
- Annotation check is automated in CI; PR will fail the `check-opencode-annotations` workflow without them.""",
"open","2026-04-29T02:13:24Z","team",None,None),

rec(42957,"review",False,
"""Summary:
- Preserves the configured Code model when implementing a plan in a new session in `packages/opencode/src/session/` (76 additions, 1 deletion, 3 files).

Checks:
- [✓] Value & approach fit — targeted behavioral fix; model is silently reset when plan is implemented
- [⚠] Real-behavior proof — no automated test; bot found no issues
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer comments; imanolmzd-svg assigned
- [⚠] CI & mergeable — mergeable unknown; owner_sla=at_risk
- [⚠] Contributor responsive — no team response for 7d; contributor waiting

Recommendation:
- review: imanolmzd-svg is the assigned reviewer; focused fix needs first code review.

Notes:
- Small and targeted (76 adds, 3 files); straightforward review.""",
"open","2026-04-30T00:08:54Z","team",None,None),

rec(44470,"decide",False,
"""Summary:
- Adds Perplexity as a first-class API provider in `packages/opencode/src/provider/` (190 additions, 2 files).

Checks:
- [⚠] Value & approach fit — Perplexity is a well-known provider; scope decision needed
- [✓] Real-behavior proof — bot found no issues; clean implementation
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer; no asks pending
- [✓] CI & mergeable — mergeable=clean
- [⚠] Contributor responsive — no team response for 7d

Recommendation:
- decide: New first-class provider requires a maintainer scope decision; implementation is clean (mergeable=clean, no bot issues) so the only gate is the scope call.

Notes:
- If scope is accepted, this is close to merge-ready; alex-alecu is suggested reviewer.""",
"open","2026-04-30T22:36:16Z","team",None,"clean"),

rec(44457,"review",False,
"""Summary:
- Adds token throughput (tok/s) metrics display to the TUI and VS Code extension (777 additions, 250 deletions, 25 files).

Checks:
- [✓] Value & approach fit — linked feature request #6579 (6 reactions); widely requested
- [✗] Real-behavior proof — CRITICAL bot finding prevents compilation
- [✗] Bot findings — CRITICAL: duplicate signal declaration breaks compilation; WARNING: throughput flashes on UI initially
- [⚠] Reviewer comments resolved — no human reviewer; CRITICAL is fresh (May 5)
- [✓] CI & mergeable — mergeable=clean; CRITICAL is code-level compilation error
- [⚠] Contributor responsive — contributor_sla=untriaged; active contributor with multiple PRs

Recommendation:
- review: contributor must fix the duplicate signal declaration CRITICAL (May 5) before team review; the fix is likely a one-line dedup.

Notes:
- CRITICAL is only 2 days old; contributor is likely to fix it quickly. Team should review once the compilation error is resolved.""",
"open","2026-05-05T11:03:20Z","team","2026-05-05T10:36:50Z","clean"),

rec(44456,"review",False,
"""Summary:
- Fixes KaTeX math rendering in the VS Code extension sidebar webview (36 additions, 16 deletions, 2 files).

Checks:
- [✓] Value & approach fit — real math rendering failure in sidebar; focused fix
- [⚠] Real-behavior proof — no screenshot; no automated test
- [✗] Bot findings — WARNING: `ADD_ATTR: ['style']` globally weakens markdown DOMPurify sanitization
- [⚠] Reviewer comments resolved — no human reviewer; catrielmuller suggested
- [⚠] Security/supply-chain — global style attribute weakens XSS sanitization in webview
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 5d

Recommendation:
- review: team must verify whether global `style` attribute allowance in DOMPurify is safe in the webview context; consider scoping the fix to KaTeX-specific elements only.

Notes:
- Security-adjacent: webview XSS surface; reviewer should confirm the sanitization relaxation is narrowly scoped.""",
"open","2026-05-02T13:30:20Z","team",None,None),

rec(44455,"review",False,
"""Summary:
- Scopes the thinking level setting by active mode and model in the VS Code extension (106 additions, 6 deletions, 3 files).

Checks:
- [✓] Value & approach fit — linked bug #9757; thinking level persistence across modes is a real bug
- [⚠] Real-behavior proof — no automated test; bot found no issues
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer comments yet
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 5d

Recommendation:
- review: markijbema is suggested reviewer; focused bug fix needs first code review.

Notes:
- Small focused change (3 files); straightforward review.""",
"open","2026-05-02T23:15:40Z","team",None,None),

rec(44454,"review",False,
"""Summary:
- Backfills missing entries in an existing `.kilo/.gitignore` file during config init in `packages/opencode/src/config/` (38 additions, 21 deletions, 1 file).

Checks:
- [✓] Value & approach fit — useful robustness fix for incremental gitignore population
- [✓] Real-behavior proof — contributor addressed bot WARNING in follow-up commit (handled the `orDie` issue)
- [⚠] Bot findings — WARNING: unreadable `.gitignore` files cause config loading to fail; contributor says 'Handled this'
- [✓] Reviewer comments resolved — contributor self-addressed bot feedback
- [✓] CI & mergeable — mergeable=clean
- [⚠] Contributor responsive — no team response for 4d

Recommendation:
- review: alex-alecu is suggested reviewer; contributor addressed bot WARNING — needs first code review with mergeable=clean.

Notes:
- Reviewer should verify the `orDie` removal doesn't silently swallow unreadable gitignore errors.""",
"open","2026-05-03T01:30:47Z","team",None,"clean"),

rec(44453,"review",False,
"""Summary:
- Catches `EEXIST` from recursive `mkdir` on Windows to prevent spurious errors in `packages/opencode/src/` (80 additions, 3 deletions, 3 files).

Checks:
- [✓] Value & approach fit — Windows-specific race condition; real platform bug
- [✓] Real-behavior proof — contributor added unit tests May 6 as requested
- [✓] Bot findings — CRITICAL (extra argument) fixed May 6 by contributor
- [✓] Reviewer comments resolved — johnnyeric asked for testing details May 4; contributor fixed CRITICAL and added tests May 6
- [✓] CI & mergeable — mergeable unknown; CRITICAL resolved
- [✓] Contributor responsive — fixed CRITICAL and added tests promptly

Recommendation:
- review: contributor fixed the CRITICAL and added tests on May 6; team needs first human code review now.

Notes:
- Contributor is responsive and addressed both the CRITICAL and testing ask; deserves prompt review.""",
"open","2026-05-06T08:27:02Z","team","2026-05-04T11:11:03Z",None),

rec(44451,"review",False,
"""Summary:
- Documents the `chunkTimeout` provider option in `packages/kilo-docs/` and claims to also propagate it to `streamText` (16 additions, 2 files).

Checks:
- [⚠] Value & approach fit — linked issue #9797; useful docs but accuracy depends on whether code fix is included
- [✗] Real-behavior proof — bot WARNING: `chunkTimeout` is NOT propagated to `streamText` in current code; 16 adds/0 deletes suggests docs-only
- [✗] Bot findings — WARNING: provider-level `chunkTimeout` is not propagated to `streamText`
- [✓] Reviewer comments resolved — no human reviewer
- [⚠] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 4d

Recommendation:
- review: reviewer must confirm whether this PR includes the code fix propagating `chunkTimeout` to `streamText` or only adds docs; if docs-only, the content would describe non-functional behavior.

Notes:
- Bot WARNING is a red flag: if the PR is pure docs without the code fix, it should not merge until the code change is included.""",
"open","2026-05-03T11:57:43Z","team",None,None),

rec(44452,"decide",False,
"""Summary:
- Adds Italian (`it`) locale files to `packages/kilo-i18n/` (1 911 additions, 17 files).

Checks:
- [⚠] Value & approach fit — new locale; needs scope/acceptance decision
- [✓] Real-behavior proof — bot found no issues; comprehensive locale files
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no reviewer assigned yet
- [✓] CI & mergeable — mergeable unknown
- [⚠] Contributor responsive — no team response for 4d

Recommendation:
- decide: New locale addition requires a maintainer decision on accepted locales and translation quality bar; catrielmuller (i18n) should own this call.

Notes:
- Implementation appears complete (1 911 additions, 17 files); if locale policy accepts Italian, this could move quickly to merge.""",
"open","2026-05-03T12:30:24Z","team",None,None),

rec(44446,"review",False,
"""Summary:
- Fixes codebase indexing status not updating on Windows in the VS Code extension (161 additions, 10 deletions, 8 files).

Checks:
- [✓] Value & approach fit — linked issue #9804 (1 reaction); Windows path-separator bug
- [⚠] Real-behavior proof — no automated test; contributor notes CI failures are unrelated to this PR
- [✓] Bot findings — no issues found
- [✓] Reviewer comments resolved — no human reviewer comments; marius-kilocode assigned
- [⚠] CI & mergeable — CI failures present but contributor claims unrelated; mergeable unknown
- [✓] Contributor responsive — provided CI context proactively

Recommendation:
- review: marius-kilocode should verify the CI failures are indeed unrelated to this PR and then review the path-separator fix.

Notes:
- Contributor's CI claim should be verified; if failures are branch-unrelated, this is a clean review.""",
"open","2026-05-04T01:55:45Z","team",None,None),

rec(44443,"review",False,
"""Summary:
- Bounds `Telemetry.shutdown` with a timeout so an unreachable PostHog endpoint cannot block CLI exit in `packages/opencode/src/telemetry/` (65 additions, 8 deletions, 5 files).

Checks:
- [✓] Value & approach fit — linked issue #9788; real CLI hang reproduced and reported
- [✓] Real-behavior proof — contributor added dedicated shutdown timeout test May 4
- [⚠] Bot findings — WARNING: static import prevents PostHog mock from replacing client under test; contributor addressed test isolation May 4
- [✓] Reviewer comments resolved — contributor proactively fixed test isolation issue
- [✓] CI & mergeable — mergeable unknown; markijbema assigned
- [✓] Contributor responsive — addressed issues same day

Recommendation:
- review: markijbema needs to verify the test isolation fix and review the shutdown timeout implementation.

Notes:
- Contributor addressed the test isolation WARNING on May 4; reviewer should confirm the mock replacement now works correctly.""",
"open","2026-05-04T07:06:10Z","team",None,None),
]

print(json.dumps({"items": items}))
