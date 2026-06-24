# Kilocode Duplicate Issues and Missing Issue-PR Relationships — Findings

**Audit date:** 2026-06-24  
**Scope:** All open issues and open pull requests in `Kilo-Org/kilocode`  
**Inventory source:** GitHub GraphQL API queries against `Kilo-Org/kilocode` open issues and open PRs (662 issues and 166 PRs as of 2026-06-24).  
**Method:** Programmatic grouping by exact/near titles, distinctive error signatures, file-path overlap, and explicit issue references, followed by manual review of bodies, comments, and diffs. Title similarity alone was not treated as sufficient evidence.

---

## 1. High-confidence duplicate open issues

High-confidence means the issues share the same root-cause component and the same materially desired outcome.

### 1.1 Auto-Approve tab sorting/filtering/grouping
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/10384
  - https://github.com/Kilo-Org/kilocode/issues/10368
- **Evidence:** Identical titles; bodies describe the same three improvements (sorting, filtering, grouping) with nearly the same wording. Created ~13 hours apart.
- **Confidence:** High
- **Canonical:** #10384 (slightly more detailed body)
- **Suggested action:** Close #10368 as duplicate of #10384.

### 1.2 macOS VS Code 7.3.31 `SyntaxError: Exported binding 'G9'` crash
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/10938
  - https://github.com/Kilo-Org/kilocode/issues/10936
  - https://github.com/Kilo-Org/kilocode/issues/10927
- **Evidence:** All report the exact same stack trace and version (`7.3.31-darwin-arm64`, `SyntaxError: Exported binding 'G9' needs to refer to a top-level declared variable.`). Maintainer commented on #10938 "fixed in 7.3.33". #10927 has the most user confirmations.
- **Confidence:** High
- **Canonical:** #10927 (most discussion and reproductions)
- **Suggested action:** Close #10938 and #10936 as duplicates of #10927; verify fix in 7.3.33 and close #10927 if resolved.

### 1.3 `.kilo/plans/*.md` blocked by permission hardening
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/11439
  - https://github.com/Kilo-Org/kilocode/issues/10983
  - https://github.com/Kilo-Org/kilocode/issues/10978
- **Evidence:** All three describe the same failure mode: the agent cannot create/edit files under `.kilo/plans/` despite explicit allow rules. #11439 provides the precise root cause (`ReadPermission.harden()` injects a `.kilo/**` deny rule after user rules, ignoring the `EXCLUDED_SUBDIRS = ["plans/"]` exemption). #10983 and #10978 show the same error message with the same allow/deny rule list.
- **Confidence:** High
- **Canonical:** #11439 (most detailed root-cause analysis)
- **Suggested action:** Close #10983 and #10978 as duplicates of #11439; do this while #11439 is still open, because PR #11512 already references closing #11439 and the duplicate links should remain resolvable against the canonical issue.

### 1.4 Kimi-2.6 "engine overloaded" with `.kilo/node_modules/` bloating context
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/10313
  - https://github.com/Kilo-Org/kilocode/issues/10260
- **Evidence:** Both blame the same provider (Kimi-2.6/K2.6), the same symptom ("engine overloaded"), and the same suspected cause (`.kilo/node_modules/` bloating the context payload). Same Kilo version `v7.2.52`.
- **Confidence:** High
- **Canonical:** #10313 (more detailed title and body)
- **Suggested action:** Close #10260 as duplicate of #10313.

### 1.5 DeepSeek `reasoning_content` must be passed back in thinking mode
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/9523
  - https://github.com/Kilo-Org/kilocode/issues/9471
- **Evidence:** Both report the same requirement: when DeepSeek models return `reasoning_content` in thinking mode, Kilo must pass it back on subsequent API calls. Same provider, same symptom, same desired outcome.
- **Confidence:** High
- **Canonical:** #9471 (older, more discussion)
- **Suggested action:** Close #9523 as duplicate of #9471.

### 1.6 Login/model dropdown error
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/11089
  - https://github.com/Kilo-Org/kilocode/issues/11088
- **Evidence:** Titles are near-identical permutations ("login or model dropdown error" vs "login error or model dropdown error"). Created 2 minutes apart by the same reporter, no comments, no additional detail.
- **Confidence:** High
- **Canonical:** #11088 (older)
- **Suggested action:** Close #11089 as duplicate of #11088.

### 1.7 Sandbox: network isolation (double submission)
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/11546
  - https://github.com/Kilo-Org/kilocode/issues/11545
- **Evidence:** Exact same title, created 6 seconds apart, empty bodies.
- **Confidence:** High
- **Canonical:** #11545 (older)
- **Suggested action:** Close #11546 as duplicate of #11545.

### 1.8 Sandbox: Windows support (double submission)
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/11542
  - https://github.com/Kilo-Org/kilocode/issues/11541
- **Evidence:** Exact same title, created 6 seconds apart, empty bodies.
- **Confidence:** High
- **Canonical:** #11541 (older)
- **Suggested action:** Close #11542 as duplicate of #11541.

### 1.9 Model not found: `kilo/kilo-auto/free`
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/9932
  - https://github.com/Kilo-Org/kilocode/issues/9789
- **Evidence:** Exact same title, both report the same model string failure.
- **Confidence:** High
- **Canonical:** #9789 (older)
- **Suggested action:** Close #9932 as duplicate of #9789.

---

## 2. PRs clearly related to an existing issue but lacking an explicit issue/closing link

These PRs mention an open issue in the title or body, yet GitHub's `closingIssuesReferences` is empty, so merging them would not auto-close the related issue.

### 2.1 PR #11619 → Issue #9138
- **PR:** https://github.com/Kilo-Org/kilocode/pull/11619
- **Issue:** https://github.com/Kilo-Org/kilocode/issues/9138
- **Evidence:** PR title includes `(#9138)`; body says "Implements #9138". No `closingIssuesReferences`.
- **Confidence:** High
- **Suggested action:** Add "Fixes #9138" to the PR description or manually close #9138 when merged.

### 2.2 PR #11590 → Issue #11541
- **PR:** https://github.com/Kilo-Org/kilocode/pull/11590
- **Issue:** https://github.com/Kilo-Org/kilocode/issues/11541
- **Evidence:** Body explains the PR addresses Windows sandboxing and references #11542, but #11541 is the canonical issue (#11542 is the duplicate in §1.8). No closing link.
- **Confidence:** High
- **Suggested action:** Link PR to #11541 (may use "Related to #11541" rather than "Fixes" because it is a prototype).

### 2.3 PR #11589 → Issue #11541
- **PR:** https://github.com/Kilo-Org/kilocode/pull/11589
- **Issue:** https://github.com/Kilo-Org/kilocode/issues/11541
- **Evidence:** Same as above: body references #11542, but #11541 is the canonical issue (#11542 is the duplicate in §1.8). No closing link. This is a competing Windows confinement prototype to #11590.
- **Confidence:** High
- **Suggested action:** Link PR to #11541 (as "Related to" or "Fixes" depending on prototype intent).

### 2.4 PR #10570 → Issue #10375
- **PR:** https://github.com/Kilo-Org/kilocode/pull/10570
- **Issue:** https://github.com/Kilo-Org/kilocode/issues/10375
- **Evidence:** Title says `fix(issue 10375)`; body opens with `#10375`. No `closingIssuesReferences`.
- **Confidence:** High
- **Suggested action:** Add "Fixes #10375" to the PR description.

### 2.5 PR #10538 → Issue #10315
- **PR:** https://github.com/Kilo-Org/kilocode/pull/10538
- **Issue:** https://github.com/Kilo-Org/kilocode/issues/10315
- **Evidence:** Body contains "Refs #10315" and describes fixing the same root cause (custom agents denied `question` tool). No `closingIssuesReferences`.
- **Confidence:** High
- **Suggested action:** Add "Fixes #10315" to the PR description.

### 2.6 PR #10267 → Issues #10249 and #9138
- **PR:** https://github.com/Kilo-Org/kilocode/pull/10267
- **Issues:** https://github.com/Kilo-Org/kilocode/issues/10249, https://github.com/Kilo-Org/kilocode/issues/9138
- **Evidence:** Body discusses implementing the Gatekeeper config contract for both the permission-classifier runtime foundation (#10249) and the broader LLM auto-approval feature (#9138). No `closingIssuesReferences`.
- **Confidence:** Medium-High
- **Suggested action:** Add "Related to #10249, #9138" to the PR description; consider whether it should close #10249.

---

## 3. Substantive PRs that should have a tracking issue but have none

Selected PRs introduce new user-facing features, significant architectural changes, or new providers, and have no linked issue reference in title, body, or `closingIssuesReferences`. A tracking issue would help triage, design review, and release notes.

| PR | Title | Additions | Files | Why it should have an issue |
|---|---|---|---|---|
| https://github.com/Kilo-Org/kilocode/pull/11355 | feat: add core project memory package | +6,003 | 47 | New core package; no open issue mentions project memory (mem0 plugin #11346 is separate). |
| https://github.com/Kilo-Org/kilocode/pull/11394 | feat(cli): interactive terminal tool | +3,810 | 49 | New CLI tool/UX surface. |
| https://github.com/Kilo-Org/kilocode/pull/10830 | feat: move marketplace installs to CLI backend | +2,960 | 38 | Architectural move of marketplace functionality. |
| https://github.com/Kilo-Org/kilocode/pull/11456 | feat(cli): add background process lifetimes | +1,887 | 24 | New lifecycle management for background processes. |
| https://github.com/Kilo-Org/kilocode/pull/11481 | feat(opencode): add /stats slash command and usage statistics API | +1,847 | 12 | New slash command and API. |
| https://github.com/Kilo-Org/kilocode/pull/10466 | feat(vscode): add local session tabs | +1,079 | 23 | New VS Code UI feature (Agent Manager local tabs). |
| https://github.com/Kilo-Org/kilocode/pull/11532 | feat(vscode): support Jupyter notebook context | +752 | 17 | New context source for Jupyter notebooks. |
| https://github.com/Kilo-Org/kilocode/pull/9762 | Add Perplexity as a first-class API provider | +559 | 18 | New first-class provider. |
| https://github.com/Kilo-Org/kilocode/pull/9649 | feat: add LLM loop detection for message/tool/reasoning | +276 | 2 | New runtime behavior / safety feature. |
| https://github.com/Kilo-Org/kilocode/pull/11195 | Add TrustedRouter provider | +235 | 10 | New provider integration. |
| https://github.com/Kilo-Org/kilocode/pull/11454 | feat(vscode): make chat width limit configurable | +182 | 30 | New user-facing setting across many files. |

**Suggested action:** For each, either create a tracking issue and link it, or explicitly mark the PR as intentional self-contained work.

---

## 4. Duplicate or competing PRs

### 4.1 Cloud Agent session tabs — superseding PRs
- **PRs:**
  - https://github.com/Kilo-Org/kilocode/pull/11359 (newer, author: marius-kilocode, draft)
  - https://github.com/Kilo-Org/kilocode/pull/10845 (older, author: eshurakov, draft)
- **Evidence:**
  - Identical title: `feat(agent-manager): add cloud agent session tabs`.
  - 79 shared changed files.
  - #11359 body explicitly states: "The earlier integration in #10845 established the extension-host transport and UI, but it drifted from current Agent Manager code and relied on facade routes that are not available. This rebases that work onto current `main`..."
- **Confidence:** High
- **Preferred PR:** #11359 (rebased onto current main, larger scope, 117 files)
- **Suggested action:** Close #10845 as superseded by #11359.

### 4.2 Clickable file links in chat — re-split
- **PRs:**
  - https://github.com/Kilo-Org/kilocode/pull/11219 (newer, draft, author: sylwester-liljegren)
  - https://github.com/Kilo-Org/kilocode/pull/10340 (older, open, same author)
- **Evidence:**
  - Same author and same feature area (clickable file links in UI).
  - 13 shared changed files.
  - #11219 body explicitly says: "Re-split of #10340 per maintainer feedback (no separate tracking issue exists). PR 2 of 2."
- **Confidence:** High
- **Preferred PR:** #11219 (draft re-split addressing maintainer feedback)
- **Suggested action:** Close #10340 as superseded by #11219.

---

## 5. Lower-confidence / related findings (appendix)

### 5.1 Edit Provider bugs in the same component but different symptoms
- **Issues:**
  - https://github.com/Kilo-Org/kilocode/issues/11191 (headers can't be removed)
  - https://github.com/Kilo-Org/kilocode/issues/11192 (stream can't be disabled)
- **Assessment:** Both are bugs in the Custom Provider edit dialog, but they describe different broken controls. Treat as related, not duplicates, until a maintainer determines a shared root cause.
- **Confidence:** Medium
- **Suggested action:** Add a cross-reference comment; keep both open pending investigation.

### 5.2 Stacked PRs with full file overlap (not duplicates)
- **PRs:**
  - https://github.com/Kilo-Org/kilocode/pull/10919
  - https://github.com/Kilo-Org/kilocode/pull/10918
- **Evidence:** Same author, identical 32 changed files, created 26 seconds apart. #10919 body explicitly says "Stacked on #10918. Until #10918 is merged/rebased, this PR includes the custom provider configuration changes from that PR as well."
- **Assessment:** Normal stacked PR; not a duplicate. No action needed.

### 5.3 Empty `[FEATURE]:` issues
- **Issues:** e.g. https://github.com/Kilo-Org/kilocode/issues/11595, https://github.com/Kilo-Org/kilocode/issues/10975, https://github.com/Kilo-Org/kilocode/issues/10904, https://github.com/Kilo-Org/kilocode/issues/10493, https://github.com/Kilo-Org/kilocode/issues/9777, https://github.com/Kilo-Org/kilocode/issues/9493, https://github.com/Kilo-Org/kilocode/issues/10344, https://github.com/Kilo-Org/kilocode/issues/10803
- **Assessment:** These share the title `[FEATURE]:` and empty bodies, but they are not duplicates of each other (no shared desired outcome). They are low-quality/incomplete feature requests.
- **Confidence:** Low as duplicates
- **Suggested action:** Close individually as incomplete/needs-info rather than as duplicates.

### 5.4 Vague Chinese-language login/connection issues
- **Issues:** e.g. https://github.com/Kilo-Org/kilocode/issues/10771 ("登录不了" / can't log in), https://github.com/Kilo-Org/kilocode/issues/10939 ("Kilo 多次使用传销响应意外" / response ended unexpectedly), https://github.com/Kilo-Org/kilocode/issues/10123 ("应该允许本地使用" / should allow local use)
- **Assessment:** Thematic overlap (connectivity in China / local use), but insufficient detail to establish shared root cause or equivalent desired outcome.
- **Confidence:** Low
- **Suggested action:** Request more detail; do not merge.

---

## 6. Limitations

- The inventory only covers **open** issues and PRs. Closed duplicates or linked PRs were not checked.
- `closingIssuesReferences` relies on GitHub's parsed link syntax; PRs that use non-standard keywords (e.g., "Supercedes #7085" in #11261) were manually reviewed.
- File-overlap detection can flag stacked PRs as duplicates; each candidate was manually inspected for explicit stacking notes before classification.
- Comments and full diff content were spot-checked for high-confidence candidates; exhaustive manual review of all 662 issues and 166 PRs was not performed.

---

## 7. Safe suggested actions summary

| # | Finding | Suggested action |
|---|---|---|
| 1 | Duplicate issues listed in §1 | Close duplicates in favor of canonical issues; verify G9 fix before closing #10927. |
| 2 | Missing PR→issue links in §2 | Edit PR descriptions to include `Fixes #N` or `Related to #N`. |
| 3 | Substantive PRs without issues in §3 | Create tracking issues or document intentional no-issue decision. |
| 4 | Competing PRs in §4 | Close older/superseded PRs (#10845, #10340) with a reference to the preferred PR. |
| 5 | Stacked PR #10919/#10918 | No action; already correctly described as stacked. |
| 6 | Empty `[FEATURE]:` issues | Close individually as incomplete. |

**No GitHub mutations were performed.**
