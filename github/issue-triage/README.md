# Issue Triage Findings

Investigation of open P0/P1 issues from [Project Board #25](https://github.com/orgs/Kilo-Org/projects/25) to determine if any have already been fixed in the codebase.

## Summary

Investigated **25 open issues** (5 P0, 20 P1). Found:

- **3 issues that should be CLOSED** (fully fixed)
- **11 issues PARTIALLY FIXED** (some work done, more needed)
- **11 issues NOT FIXED** (still need work)

### ✅ Issues That Should Be Closed

| # | Priority | Title | Notes |
|---|----------|-------|-------|
| [#6064](6064.md) | P1 | Autocomplete (VSCode Extension) | Full autocomplete subsystem implemented with ~30 files |
| [#6143](6143.md) | P1 | Continually prompted to implement in Plan mode | Fixed via `shouldAskPlanFollowup()` with comprehensive tests |
| [#6255](6255.md) | P1 | Clickable items should change the cursor | Already closed on GitHub; `cursor: pointer` added to all interactive elements |

### ⚠️ Issues Partially Fixed (need remaining work or unmerged PRs)

| # | Priority | Title | What's Missing |
|---|----------|-------|----------------|
| [#6574](6574.md) | P0 | Permissions boxes for Read don't show filename | `BasicTool` suppresses subtitle in pending state; hacky fix exists but structural issue remains |
| [#6617](6617.md) | P0 | Increase clarity of permissions box | Yellow border fix exists on branch but PRs were closed without merging |
| [#6558](6558.md) | P0 | Make it easy to grab provider/inference error details | Backend captures rich errors but UI only shows message text, no copy/expand |
| [#6399](6399.md) | P1 | Logging in/out isn't persisted properly | Root fix on unmerged branch `mark/fix-auth-persistence-6399`; symptom mitigation merged |
| [#6068](6068.md) | P1 | Provider Settings (VSCode Extension) | ProvidersTab exists but missing API key management and proper provider names |
| [#6092](6092.md) | P1 | Full path never shown in approval boxes | Fixed for read/directory listing; edit/write still use relative paths |
| [#6188](6188.md) | P1 | Onboarding experience for upgraders | Migration wizard works for legacy users; no onboarding for fresh installs |
| [#6211](6211.md) | P1 | Remember last model choice (VSCode) | Read side implemented; write side (persisting changes) missing |
| [#6256](6256.md) | P1 | Show terminal command details in UI | Command and output shown inline; exit code indicator missing |
| [#6339](6339.md) | P1 | Plan to code switching | PlanFollowup system works; auto-switch permission setting not implemented |
| [#6371](6371.md) | P1 | Improve Permission Settings (VSCode) | AutoApproveTab exists with per-tool settings; per-pattern command rules missing |
| [#6403](6403.md) | P1 | Filter subagent sessions from history | Fix exists on unmerged branch `fix/6403-filter-subagent-sessions` |

### ❌ Issues Not Fixed

| # | Priority | Title | Notes |
|---|----------|-------|-------|
| [#6552](6552.md) | P0 | LLM.stream small-model requests leak into subsequent session | Static session IDs and shared SDK instances cause cross-session contamination |
| [#6618](6618.md) | P0 | Make it clear what you are always approving | VS Code extension missing two-stage "always approve" confirmation (TUI has it) |
| [#6074](6074.md) | P1 | Use correct default model | Hardcoded fallbacks ignore CLI defaults and user config |
| [#6082](6082.md) | P1 | Anonymous signin prompts (VSCode) | No proactive sign-in prompts for anonymous users |
| [#6163](6163.md) | P1 | Custom OpenAI-Compatible Provider UI | No custom provider form in settings UI |
| [#6221](6221.md) | P1 | Markdown syntax highlighting blocks main thread | Still synchronous `codeToHtml()` on main thread |
| [#6230](6230.md) | P1 | Re-adding Architect mode / Plan writes to /plans | No Architect mode; plans stored in `.opencode/plans/` not top-level |
| [#6370](6370.md) | P1 | Plan files saved in opencode directory | Still hardcoded to `.opencode/plans/` instead of `.kilocode/plans/` |
| [#6373](6373.md) | P1 | Feedback button prior to beta | No dedicated feedback button; only passive link in About tab |
| [#6541](6541.md) | P1 | Clear what command/folder added to permissions | No explanation or granularity options in "Allow Always" dialog |

### Key Themes

1. **Unmerged fix branches**: Several issues (#6399, #6403, #6617) have working fixes on branches that were never merged to `main`
2. **Permissions UX**: 5 of the 25 issues relate to permission box clarity — this is the biggest UX gap
3. **VS Code ↔ CLI parity**: The TUI often has features (two-stage always-approve, plan follow-up) that the VS Code extension lacks
4. **Branding**: `.opencode/` paths haven't been renamed to `.kilocode/` (#6370)
