# Kilocode Open PR Quality and Human-Validation Audit

**Scope:** All open pull requests in `Kilo-Org/kilocode` as of 2026-06-24.  
**Auditor:** Birch-polecat-61b77f41  
**Method:** This assessment uses the live GitHub PR inventory reconstructed on 2026-06-24 (the temporary task-0 inventory artifact was not present in `docs/audits/work/`). For every open PR we recorded author, draft status, changed-file/line counts, review/comment authors, status-check results, and the `kilo-code-bot` review summary where present. We then inspected the bodies and diffs of the highest-risk PRs.  
**Important framing:** This is a risk/evidence audit, not an authorship accusation. We flag concrete quality deficiencies *combined with* absent substantive human validation. AI/automation indicators are reported separately from objective quality findings.

## Summary

- **166 open PRs** were inventoried.
- **18 PRs** had zero reviews or comments of any kind.
- **63 PRs** had only bot interaction (`kilo-code-bot`, `dependabot[bot]`, or `github-actions[bot]`).
- **77 PRs** had mixed bot + human interaction.
- **8 PRs** had only human interaction.

The most concerning pattern is a set of **non-draft PRs authored by `app/kilo-code-bot` or external contributors that carry unresolved `kilo-code-bot` findings and no human response**. Several very large draft PRs also lack any human review despite failing CI or having obvious architectural risk.

## Definitions

| Term | Meaning in this report |
|---|---|
| **Quality deficiency** | Failing required checks, unresolved `kilo-code-bot` findings, empty/placeholder PR bodies, sweeping changes without tests, fabricated/unverified claims, or "DO NOT MERGE" in a non-draft PR. |
| **Substantive human validation** | A review, requested-change thread, or substantive comment from a non-bot maintainer/team member that addresses code quality, not just CI triggers or title edits. |
| **AI/automation indicator** | Authored by a bot account, use of agent session branch names (`session/agent-*`), or branch names like `docs/daily-sync-*`. These are indicators only, not conclusions about quality. |
| **No human validation** | No non-bot reviews or comments. |

## High-confidence findings

Quality deficiency is concrete and no meaningful human validation is visible.

### 1. #11634 — `Feat/indexing graph tools` (external contributor, bot-only, unresolved issues, blank template)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11634
- **Author:** `Product-X-Deepak`
- **State:** Open, non-draft
- **Size:** +5,749 / -152 across 102 files
- **Quality findings:**
  - PR body is an unmodified template: `Fixes #`, all section prompts left empty (`<!-- Brief description of WHAT you're doing and WHY. -->`, `## Context`, `## Implementation`, `## Screenshots / Video`, etc.).
  - `kilo-code-bot` reported **6 WARNINGs** and recommended "Address before merge". Concrete issues include:
    - Cross-session tool-call deduplication key omits session/worktree context (`packages/opencode/src/session/tools.ts:31`).
    - No-op embedder fallback still fails because vector-store setup cannot resolve a `noop` embedding profile (`packages/kilo-indexing/src/indexing/service-factory.ts:134`).
    - Call edges stored at file scope cause every callable in a file to inherit the same callee set (`packages/kilo-indexing/src/indexing/graph/integration.ts:89`).
    - Side-effect imports dropped from `import_map`, breaking dependency analysis (`packages/kilo-indexing/src/indexing/graph/database.ts:169`).
    - `usingDaemon` never reset after fallback, risking orphan backend on dispose (`packages/kilo-vscode/src/services/cli-backend/server-manager.ts:128`).
    - Call-hierarchy requests ignore requested max depth (`packages/opencode/src/kilocode/indexing-worker.ts:140`).
  - Merge state `DIRTY`; only one status check visible.
- **AI/automation indicator:** None observed beyond the blank template and large unreviewed change.
- **Human validation:** None. Only `kilo-code-bot` has commented/reviewed.
- **Confidence:** **High**.
- **Recommended action:** Request the author fill out the PR template, address the six bot findings, and request human review before merging.

### 2. #11411 — `DO NOT MERGE feat(vscode): add Import Sessions from Roo Code command` (non-draft with explicit "DO NOT MERGE")
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11411
- **Author:** `markijbema`
- **State:** Open, **non-draft**
- **Size:** +661 / -67 across 34 files
- **Quality findings:**
  - Title explicitly says **"DO NOT MERGE"**, yet the PR is open and not marked as draft, so it appears in review queues and could be merged accidentally.
  - Body is otherwise coherent and the diff appears intentional.
- **AI/automation indicator:** None.
- **Human validation:** None. Zero reviews/comments.
- **Confidence:** **High** for the validation/process gap; content quality itself was not deeply audited.
- **Recommended action:** Convert to draft or close until ready for review.

### 3. #11553 — `fix(jetbrains): stabilize settings apply lifecycle` (huge draft, multiple CI failures, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11553
- **Author:** `kirillk`
- **State:** Open, draft
- **Size:** +7,064 / -467 across 92 files; diff is ~2.8 MB
- **Quality findings:**
  - **Failing checks:** `Check kilocode_change annotations`, `unit (linux)`, `jetbrains / jetbrains`, `jetbrains / result`, `test (linux)`, `unit results (jetbrains)`.
  - Body describes a broad refactor of JetBrains configurable pages (Models, Agents, Rules, Skills) with shared draft lifecycle.
- **AI/automation indicator:** None.
- **Human validation:** None. Zero reviews/comments.
- **Confidence:** **High** that the PR currently lacks validation and is not merge-ready; the failures may be expected for a draft, but the absence of any human engagement on a 7 KLOC/92-file change is a material gap.
- **Recommended action:** Author should fix CI and request human review; do not merge until checks pass and a JetBrains maintainer reviews.

### 4. #11529 — `fix(vscode): add context to settings descriptions` (bot-authored, non-draft, 19 unresolved i18n regressions)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11529
- **Author:** `app/kilo-code-bot`
- **State:** Open, non-draft
- **Size:** +333 / -171 across 25 files
- **Quality findings:**
  - `kilo-code-bot` reported **19 WARNINGs**: English placeholders replace translated settings help in 18 i18n locale files (`ar`, `br`, `bs`, `da`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `no`, `pl`, `ru`, `th`, `tr`, `uk`, `zh`, `zht`).
- **AI/automation indicator:** Author is `app/kilo-code-bot`; branch `fix/vscode-settings-descriptions`.
- **Human validation:** None. Only the same bot account reviewed; no human has confirmed or corrected the translations.
- **Confidence:** **High**.
- **Recommended action:** Either have a human i18n reviewer restore translations or close this bot PR until the i18n regressions can be addressed.

### 5. #11399 — `fix: flatten suggest tool params to fix JSON parsing failures with Claude` (bot-authored, failing checks, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11399
- **Author:** `app/kilo-code-bot`
- **State:** Open, non-draft, merge state `BLOCKED`
- **Size:** +33 / -14 across 3 files
- **Quality findings:**
  - `kilo-code-bot` reported **1 issue** and recommended "Address before merge".
  - Merge state blocked, suggesting check failures.
- **AI/automation indicator:** Author is `app/kilo-code-bot`; branch `session/agent_...`.
- **Human validation:** None.
- **Confidence:** **High** that a bot-generated PR is open without human validation.
- **Recommended action:** Human review required before any merge.

## Medium-confidence findings

Concrete quality or validation gaps, but with mitigating circumstances (e.g., the PR is a draft, the issue is narrow, or the bot finding is minor).

### 6. #11508 — `Feat/hashline edit tool` (external contributor, bot found 3 issues, no human follow-up)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11508
- **Author:** `nigamanandajoshi`
- **State:** Open, non-draft
- **Size:** +1,490 / -8 across 9 files
- **Quality findings:**
  - Bot reported 3 WARNINGs:
    - New config key needs cloud schema mirror (`packages/opencode/src/config/config.ts:226`).
    - `hashLength` can exceed parser's 8-char limit (`packages/opencode/src/config/config.ts:230`).
    - Unconditional `stripHashes()` can rewrite untouched file content (`packages/opencode/src/kilocode/tool/hash_edit.ts:80`).
  - Previous review snapshot had 5 issues; author reduced to 3 but did not resolve all.
- **AI/automation indicator:** None.
- **Human validation:** None. Only `kilo-code-bot`.
- **Confidence:** **Medium** (the PR has a coherent body and tests; issues are addressable but unaddressed).
- **Recommended action:** Author should respond to the three remaining bot findings and request human review.

### 7. #11394 — `feat(cli): interactive terminal tool` (external contributor, template placeholder, bot issues, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11394
- **Author:** `catrielmuller`
- **State:** Open, non-draft
- **Size:** +3,810 / -154 across 49 files
- **Quality findings:**
  - Body contains an empty issue link (`Fixes #`) and template section prompts.
  - Bot found 1 WARNING + 1 SUGGESTION, plus observations that ~110 lines of `ShellPermission` were added to a shared upstream file instead of `src/kilocode/`, and unrelated prettier churn was bundled in.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium**.
- **Recommended action:** Fill out the issue link/template, address the upstream-diff minimization suggestion, and request human review.

### 8. #11436 — `feat: add experimental voice-steered design mode` (draft, large new Swift sidecar, bot issues)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11436
- **Author:** `Drixled`
- **State:** Open, draft
- **Size:** +2,219 / -1 across 29 files
- **Quality findings:**
  - Adds a new Swift Apple Speech sidecar and a design fixture app.
  - Bot found 3 WARNINGs: session-scoped `TurnClose` race after Esc, dropped cleanup promise may leave voice helper alive, and `push-to-talk` exposed but unimplemented.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (draft status is appropriate for experimental work, but the lack of any human review on a new cross-platform sidecar is a gap).
- **Recommended action:** Mark as experimental/keep draft; request architecture review before marking ready.

### 9. #11609 — `feat(indexing): support 'auto' dimension with runtime detection fallback` (author states PR is untested)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11609
- **Author:** `rrauenza`
- **State:** Open, non-draft, merge state `BLOCKED`
- **Size:** +108 / -14 across 3 files
- **Quality findings:**
  - Body begins: `<I'm going to take this out of draft to see if it triggers CI - I haven't successfully pulled the plugin into my vscode yet.)`
  - Bot found 2 WARNINGs about runtime detection not covering baseline-backed worktrees and not applying to `openai-compatible` embeddings.
  - Merge state blocked.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (small scope, but author explicitly acknowledges it has not been end-to-end validated and checks are failing).
- **Recommended action:** Author should validate the change in a real workspace and address the two bot findings before requesting review.

### 10. #10617 — `fix(cli): reduce grep context amplification` (non-draft, failing Kilo Code Review, no comments)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/10617
- **Author:** `marius-kilocode`
- **State:** Open, non-draft
- **Size:** +142 / -9 across 4 files
- **Quality findings:**
  - **Failing check:** `Kilo Code Review`.
  - Body is coherent and explains the problem.
- **AI/automation indicator:** None.
- **Human validation:** None. Zero comments/reviews.
- **Confidence:** **Medium** (we cannot see the exact bot finding without the check-run details, but the failing review gate + no human response is a validation gap).
- **Recommended action:** View the Kilo Code Review check output, address findings, and request human review.

### 11. #10704 — `fix(jetbrains): show history runtime summaries` (draft, 8 failing checks)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/10704
- **Author:** `kirillk`
- **State:** Open, draft
- **Size:** +1,210 / -130 across 44 files
- **Quality findings:**
  - **Failing checks:** `link-checker`, `unit (linux)`, `unit (windows)`, plus JetBrains/unit result aggregators.
  - Body says "No linked issue" and describes a broad JetBrains history refactor.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (draft status makes failures less severe, but 44 files and 8 failing checks with no human engagement is notable).
- **Recommended action:** Fix checks and request human review before undrafting.

### 12. #11527 — `feat(kilocode): implement skill management and marketplace` (large draft, no status checks, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11527
- **Author:** `idreesmuhammadqazi-create`
- **State:** Open, draft
- **Size:** +2,352 / -824 across 14 files
- **Quality findings:**
  - Large new feature (skill install/remove/folder API, TUI components, SDK updates) with **zero status checks** visible (possibly not run or not reported).
  - Body is brief.
- **AI/automation indicator:** None (author is a human contributor).
- **Human validation:** None.
- **Confidence:** **Medium** (draft status is appropriate, but the absence of CI and human review on a multi-package feature is a gap).
- **Recommended action:** Run CI, add tests/verification, and request human review before undrafting.

### 13. #11611 — `feat: add provider usage center` (large draft, no status checks, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11611
- **Author:** `lambertjosh`
- **State:** Open, draft
- **Size:** +4,559 / -11 across 57 files
- **Quality findings:**
  - Very large new feature spanning CLI, TUI, SDK, and VS Code profile.
  - **Zero status checks** visible.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (draft status justifies the absence of checks, but the size and lack of any human engagement warrants monitoring).
- **Recommended action:** Break into smaller PRs or get an early architecture review; ensure CI runs before undrafting.

### 14. #11131 — `Add agent step checkpoints to VS Code` (large draft, no checks, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11131
- **Author:** `marius-kilocode`
- **State:** Open, draft
- **Size:** +2,904 / -477 across 65 files
- **Quality findings:**
  - Large checkpoint/rewind feature.
  - **Zero status checks** visible.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (draft).
- **Recommended action:** Request early design review before undrafting.

### 15. #11177 — `feat(provider): Morph auto model routing` (external draft, no checks, no human review)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11177
- **Author:** `shreybirmiwalmorph`
- **State:** Open, draft
- **Size:** +1,003 / -3 across 29 files
- **Quality findings:**
  - Adds a third-party provider router; body explains MorphLLM router but the PR itself has no status checks.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (draft; external contributor with potential commercial interest).
- **Recommended action:** Security/privacy review should be requested because user prompts are classified by a third-party API.

### 16. #11589 / #11590 — Prototype Windows confinement helpers (draft pair, no human review)
- **URLs:**
  - #11589: https://github.com/Kilo-Org/kilocode/pull/11589 (`feat(sandbox): prototype Windows process confinement`)
  - #11590: https://github.com/Kilo-Org/kilocode/pull/11590 (`feat(sandbox): prototype Zig Windows confinement`)
- **Author:** `marius-kilocode`
- **State:** Both open drafts
- **Size:** #11589 +1,577 / -4 (12 files); #11590 +1,127 / -4 (14 files)
- **Quality findings:**
  - Both implement the same Windows sandbox backend in different languages (native helper vs. Zig) to compare before choosing a production direction.
  - #11590 is merge-state `BLOCKED`.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Medium** (drafts by design; the concern is that two large native-code prototypes sit open with no human review and no decision recorded).
- **Recommended action:** Have a maintainer record a decision on which prototype to pursue or close the rejected one.

## Low-confidence / watch-list findings

These PRs show some risk signal but are either expected to be automated, small, or clearly drafts.

### 17. Bot-generated PRs with unresolved bot findings and no human validation
- **#11009** `fix(cli,vscode): normalize SSH git remote URLs to canonical` — `app/kilo-code-bot`, 3 issues, no human review.
- **#11127** `feat(vscode): add Kilo Pass promotional banner to sidebar` — `app/kilo-code-bot`, 3 issues, no human review.
- **#11167** `feat(vscode): add Kilo Pass banner to profile view with PostHog event` — `app/kilo-code-bot`, 3 issues, no human review.
- **#11471** `docs(review): update REVIEW.md guidance` — `app/kilo-code-bot`, no human review (very small docs change).
- **#11575** `docs: rewrite rate-limits-and-costs as Cost Efficiency & Model Selection guide` — `app/kilo-code-bot`, no human review.
- **#11618** `docs: promote Auto Efficient to subsection and reorder tiers` — `app/kilo-code-bot`, no human review.
- **#10811** `Review reports for PR #10790 (OpenCode v1.14.42)` — `app/kilo-code-bot`, draft, explicitly "do not merge".
- **AI/automation indicator:** All authored by `app/kilo-code-bot`.
- **Quality findings:** The first three have unresolved bot issues; the rest are docs-only.
- **Human validation:** None.
- **Confidence:** **Low to Medium** for the three with issues; **Low** for docs-only bot PRs.
- **Recommended action:** Establish a policy that bot-authored PRs must be explicitly approved by a human before merge, even for small docs changes.

### 18. Dependabot PRs with bot-only "issues"
- **#11457** `chore(deps): bump dompurify from 3.4.2 to 3.4.11 in /packages/ui`
- **#11336** `chore(deps-dev): bump vite from 7.3.2 to 7.3.5 in /packages/kilo-ui`
- **#11272** `chore(deps-dev): bump vite from 7.3.2 to 7.3.5 in /packages/kilo-vscode`
- **AI/automation indicator:** Dependabot.
- **Quality findings:** `kilo-code-bot` flagged 1 issue each; these are likely false positives on dependency bumps.
- **Human validation:** None.
- **Confidence:** **Low**.
- **Recommended action:** Standard dependabot triage; not flagged for quality concerns.

### 19. #11359 — `feat(agent-manager): add cloud agent session tabs` (large draft, possible duplicate of #10845)
- **URL:** https://github.com/Kilo-Org/kilocode/pull/11359
- **Author:** `marius-kilocode`
- **State:** Open, draft, merge state `DIRTY`
- **Size:** +7,576 / -185 across 117 files
- **Quality findings:**
  - Body states this is a rebase of earlier work in **#10845** (`feat(agent-manager): add cloud agent session tabs`) because that PR "drifted from current Agent Manager code."
  - All visible checks pass, but the PR is dirty.
- **AI/automation indicator:** None.
- **Human validation:** None.
- **Confidence:** **Low** for quality deficiency (it may be a legitimate rebase), but **Medium** for validation gap and duplicate/PR-relationship risk.
- **Recommended action:** Coordinate with #10845; decide which PR to keep and close or update the other.

## Cross-cutting observations

1. **Bot-only review is not validation.** In 63 PRs the only interaction is from bots. In many of those the bot explicitly recommended "Address before merge," yet no human has followed up.
2. **Empty PR templates correlate with low quality.** #11634 and #11394 left the issue-link and template sections empty. The template is a lightweight validation gate that is currently not enforced.
3. **Large draft PRs are not being reviewed early.** Several 1 KLOC+ draft PRs (#11553, #11611, #11527, #11131, #11359) have zero comments, suggesting maintainers do not do early-stage design reviews.
4. **AI-generated PRs are open as non-draft.** PRs authored by `app/kilo-code-bot` are routinely left open and non-draft even when the bot itself reports issues. This creates merge risk.

## Recommendations (safe, no GitHub mutations)

1. For every PR in the **High-confidence** section, request a human maintainer review and do not merge until findings are addressed.
2. Convert **#11411** to draft or close it because the title says "DO NOT MERGE".
3. Require bot-authored PRs to have explicit human approval before merge; consider automatically labeling them `ai-generated` for visibility.
4. Enforce the PR template check (non-empty issue link, context, and testing evidence) before a PR can be marked ready for review.
5. For the Windows sandbox prototypes (#11589/#11590) and cloud agent tabs (#11359/#10845), record a decision and close the rejected alternatives.
6. Re-run this analysis after the backlog cleanup in task 1 to confirm that human validation gaps are closed.

## Methodology notes and limitations

- We inspected the **166 currently open PRs**. The task-0 inventory artifact was not found in `docs/audits/work/`, so we reconstructed the inventory directly from the GitHub API.
- `kilo-code-bot` is treated as a bot for validation purposes even though the API sometimes reports `is_bot: false`, because its login name and review format identify it as the automated code-review agent.
- We did not run local tests or clone every branch. Quality findings rely on visible CI status, `kilo-code-bot` output, and manual inspection of PR bodies and diffs.
- We did **not** infer AI authorship from prose style. AI/automation indicators are based on bot authorship, branch names, or explicit author statements.
- We did **not** comment, close, label, or otherwise mutate any PR.
