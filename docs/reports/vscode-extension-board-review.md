# VS Code Extension Project Board Review

**Project:** [New VS Code Extension (#25)](https://github.com/orgs/Kilo-Org/projects/25)
**Date:** March 5, 2026
**Board last updated:** March 5, 2026

---

## Summary

The "New VS Code Extension" project board (Project #25) tracks issues for the new Kilo VS Code extension (`packages/kilo-vscode/`), which replaces the legacy Cline-based extension with a new architecture built on the CLI engine (`packages/opencode/`) communicating via HTTP + SSE using `@kilocode/sdk`.

The board contains issues spanning frontend UI work, backend/agent-manager integration, onboarding, migration, provider support, and performance. Issues are tracked using labels rather than explicit P0/P1/P2/P3 priority labels. The effective priority signal comes from the `blocking` label (critical/P0-equivalent) and `under-review` label (actively being evaluated by the product team).

### Board Composition (identified issues)

| Category                                          | Count                  |
| ------------------------------------------------- | ---------------------- |
| Open bugs                                         | ~12                    |
| Open enhancements/features                        | ~22                    |
| Closed issues (still associated with the project) | 7                      |
| Issues with `blocking` label (P0-equivalent)      | 3 (extension-specific) |
| Issues with `under-review` label                  | 4 (extension-specific) |

---

## Already-Resolved Issues

The following issues are closed but were found associated with the new VS Code extension scope. If they still appear on the project board, they should be archived or moved to a "Done" column.

| #                                                         | Title                                                                                 | Closed Date | Labels                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| [#6071](https://github.com/Kilo-Org/kilocode/issues/6071) | [FEATURE]: Provider configuration and switching (VSCode Extension)                    | 2026-02-23  | user-interface, frontend, enhancement           |
| [#6066](https://github.com/Kilo-Org/kilocode/issues/6066) | [FEATURE]: Cloud task support (VSCode Extension)                                      | 2026-02-26  | backend, under-review, enhancement              |
| [#6140](https://github.com/Kilo-Org/kilocode/issues/6140) | [BUG] Kilo-vscode ProfileView missing back button to return to chat                   | 2026-02-26  | good first issue, user-interface, frontend, bug |
| [#6244](https://github.com/Kilo-Org/kilocode/issues/6244) | Switch to using Session Turn in the vscode extension                                  | 2026-02-25  | agent-manager, enhancement                      |
| [#6252](https://github.com/Kilo-Org/kilocode/issues/6252) | [VSCode] Add way to see what a subagent is doing                                      | 2026-03-03  | user-interface, agent-manager, bug              |
| [#6034](https://github.com/Kilo-Org/kilocode/issues/6034) | Agent from "Agent manager" hangs on file deletion                                     | 2026-02-24  | blocking, windows, agent-manager                |
| [#6032](https://github.com/Kilo-Org/kilocode/issues/6032) | Calling "Review" agents in "Agent mode" completely misses current uncommitted changes | 2026-02-24  | backend, agent-manager                          |
| [#6426](https://github.com/Kilo-Org/kilocode/issues/6426) | Permissions boxes are no longer propagating to the UI from subagents                  | 2026-03-02  | blocking, frontend, agent-manager, bug          |

---

## High-Priority (Blocking / P0-equivalent) Issues -- Beta Necessity Assessment

The board does not use explicit P0/P1/P2/P3 labels. The `blocking` label serves as the de facto critical priority marker. Below is an assessment of all blocking and high-signal open issues for whether they are truly necessary for a beta release.

### Blocking Issues (P0-equivalent)

| #                                                         | Title                                                                                    | State  | Beta Necessary? | Assessment                                                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#6221](https://github.com/Kilo-Org/kilocode/issues/6221) | perf: Markdown syntax highlighting blocks main thread for 2.3s+ during session switching | OPEN   | **Yes**         | A 2.3s+ UI freeze on session switch is a dealbreaker for any user-facing beta. This directly impacts core usability.                                                 |
| [#6203](https://github.com/Kilo-Org/kilocode/issues/6203) | Extension host terminated unexpectedly (SIGILL, code 132) on task creation               | OPEN   | **Yes**         | 100% reproducible crash on Ubuntu with specific hardware. Affects core functionality (creating tasks). Must be fixed or at minimum understood/mitigated before beta. |
| [#6426](https://github.com/Kilo-Org/kilocode/issues/6426) | Permissions boxes are no longer propagating to the UI from subagents                     | CLOSED | **N/A**         | Already resolved (2026-03-02). Should be archived on the board.                                                                                                      |

### High-Priority Bugs (P1-equivalent)

| #                                                         | Title                                                                         | State | Beta Necessary? | Assessment                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ----- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| [#6145](https://github.com/Kilo-Org/kilocode/issues/6145) | Infinite render loop in ModelPicker causing Maximum call stack exceeded       | OPEN  | **Yes**         | Crashes the extension UI. A model picker crash blocks the core workflow of selecting a model.                  |
| [#6086](https://github.com/Kilo-Org/kilocode/issues/6086) | VSCode extension does not refresh on restart/update                           | OPEN  | **Yes**         | Users see stale UI after extension updates. Creates confusion and undermines trust in the product.             |
| [#6594](https://github.com/Kilo-Org/kilocode/issues/6594) | Sessions lost between restarts                                                | OPEN  | **Yes**         | Data loss is a critical trust issue. Users losing their session history will churn immediately.                |
| [#6552](https://github.com/Kilo-Org/kilocode/issues/6552) | bug: LLM.stream small-model requests leak into subsequent agent session       | OPEN  | **Yes**         | Causes incorrect model routing which leads to unexpected billing and broken responses. Core reliability issue. |
| [#6377](https://github.com/Kilo-Org/kilocode/issues/6377) | (new extension) Model Override field does not stay specific to selected agent | OPEN  | **Yes**         | Changing one agent's model override affects all agents. This is a functional bug in a core feature.            |
| [#6350](https://github.com/Kilo-Org/kilocode/issues/6350) | Extension causes high CPU load                                                | OPEN  | **Yes**         | Performance issues that make the extension unusable on Windows will drive users away during beta.              |

### High-Priority Features (P1-equivalent) -- Beta Necessity Assessment

| #                                                         | Title                                                                    | State | Beta Necessary? | Assessment                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#6082](https://github.com/Kilo-Org/kilocode/issues/6082) | Implement anonymous signin prompts (VSCode)                              | OPEN  | **Yes**         | Without signup prompts, anonymous users hitting paid model or message limits have no guidance. Essential for conversion/monetization.                                             |
| [#6188](https://github.com/Kilo-Org/kilocode/issues/6188) | Add 'onboarding' experience for people upgrading to the new extension    | OPEN  | **Yes**         | Existing users upgrading will be confused by missing sessions and changed settings. Critical for retention during the transition.                                                 |
| [#6068](https://github.com/Kilo-Org/kilocode/issues/6068) | Implement Provider Settings (VSCode Extension)                           | OPEN  | **Yes**         | Users need to configure their AI providers. Without this, BYOK users cannot use the extension at all.                                                                             |
| [#6088](https://github.com/Kilo-Org/kilocode/issues/6088) | Improve markdown rendering within new VSCode extension                   | OPEN  | **Partially**   | Poor markdown rendering affects perceived quality, but is not functionally blocking. Could ship with basic rendering and improve post-beta.                                       |
| [#6256](https://github.com/Kilo-Org/kilocode/issues/6256) | Show terminal command execution details and output in the UI             | OPEN  | **Yes**         | Users report feeling "spooky" not seeing what commands are executing. Transparency is essential for trust, especially in a beta where users are evaluating the product.           |
| [#6250](https://github.com/Kilo-Org/kilocode/issues/6250) | Make it clear how to start a new task/escape current task                | OPEN  | **Yes**         | Feature parity with legacy extension. Users who can't figure out how to start a new task will abandon the product.                                                                |
| [#6371](https://github.com/Kilo-Org/kilocode/issues/6371) | Improve Permission Settings (VSCode Extension)                           | OPEN  | **Deferrable**  | Permission settings improvements are quality-of-life. Basic permissions already work. Can iterate post-beta.                                                                      |
| [#6073](https://github.com/Kilo-Org/kilocode/issues/6073) | Agent Manager support (VSCode Extension)                                 | OPEN  | **Deferrable**  | Agent Manager is a differentiating feature but not essential for basic single-agent usage in beta. Could be introduced post-beta.                                                 |
| [#6064](https://github.com/Kilo-Org/kilocode/issues/6064) | Autocomplete (VSCode Extension)                                          | OPEN  | **Deferrable**  | Autocomplete is a valuable feature but the core chat/agent flow works without it. Can be a post-beta addition. Currently under-review.                                            |
| [#6078](https://github.com/Kilo-Org/kilocode/issues/6078) | Support for file attachments to session message input (VSCode Extension) | OPEN  | **Deferrable**  | Nice-to-have for beta. Users can reference files via @ mentions or by path. Full attachment support can come later.                                                               |
| [#6072](https://github.com/Kilo-Org/kilocode/issues/6072) | Redo previous message (VSCode Extension)                                 | OPEN  | **Deferrable**  | Convenience feature. Users can retype or copy-paste. Not blocking for beta.                                                                                                       |
| [#6144](https://github.com/Kilo-Org/kilocode/issues/6144) | Add codebase indexing to new extension and CLI                           | OPEN  | **Deferrable**  | Currently under-review. The issue itself asks "lets discuss if we should actually do this." Not a beta requirement.                                                               |
| [#6090](https://github.com/Kilo-Org/kilocode/issues/6090) | Migrate sessions from old extension to new                               | OPEN  | **Deferrable**  | Marked as kilo-duplicate. While session migration is nice, issue #6188 (onboarding for upgraders) covers the user communication aspect. Full migration is complex and can follow. |
| [#6163](https://github.com/Kilo-Org/kilocode/issues/6163) | Add Custom OpenAI-Compatible Provider UI                                 | OPEN  | **Deferrable**  | Important for local-LLM and BYOK users, but can be configured via `opencode.json` as a workaround. UI can come post-beta.                                                         |
| [#6067](https://github.com/Kilo-Org/kilocode/issues/6067) | Marketplace support (MCP, Modes, Skills)                                 | OPEN  | **Deferrable**  | Browsing/installing from a marketplace is a growth feature, not a core beta requirement.                                                                                          |
| [#6347](https://github.com/Kilo-Org/kilocode/issues/6347) | Improve mode switching UX                                                | OPEN  | **Deferrable**  | UX polish. Mode switching works, just needs to be smoother. Post-beta refinement.                                                                                                 |
| [#6376](https://github.com/Kilo-Org/kilocode/issues/6376) | Model Override for agents should be a dropdown                           | OPEN  | **Deferrable**  | UX improvement for the Agent Manager. The text field works functionally.                                                                                                          |
| [#6125](https://github.com/Kilo-Org/kilocode/issues/6125) | Allow tools to stop the agent loop via metadata                          | OPEN  | **Deferrable**  | Backend/architecture improvement. Community proposal. Not needed for beta.                                                                                                        |
| [#6120](https://github.com/Kilo-Org/kilocode/issues/6120) | Learn Mode agent for AI-mentored coding                                  | OPEN  | **Deferrable**  | New agent type proposal. Clearly post-beta scope.                                                                                                                                 |
| [#6060](https://github.com/Kilo-Org/kilocode/issues/6060) | Agent-scoped MCP tool filtering                                          | OPEN  | **Deferrable**  | Advanced MCP feature. Community proposal. Not needed for beta.                                                                                                                    |
| [#6584](https://github.com/Kilo-Org/kilocode/issues/6584) | Agentic search when searching sessions                                   | OPEN  | **Deferrable**  | Enhancement to session search. Basic search works.                                                                                                                                |
| [#6619](https://github.com/Kilo-Org/kilocode/issues/6619) | Reduce borders around agent content                                      | OPEN  | **Deferrable**  | UI polish. Not a beta blocker.                                                                                                                                                    |
| [#6234](https://github.com/Kilo-Org/kilocode/issues/6234) | Look at session preview (session list, three task on start screen)       | OPEN  | **Deferrable**  | Session previews work, just need better summarization. Polish item.                                                                                                               |

### Lower-Priority Items

| #                                                         | Title                                                         | State | Assessment                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| [#6081](https://github.com/Kilo-Org/kilocode/issues/6081) | Fix icon for context compression (feels like closing session) | OPEN  | Good first issue. Quick icon swap. Low effort, high UX impact -- worth doing for beta. |
| [#6048](https://github.com/Kilo-Org/kilocode/issues/6048) | Tasks take up way too much size                               | OPEN  | UI polish. Deferrable.                                                                 |
| [#6051](https://github.com/Kilo-Org/kilocode/issues/6051) | Broken link in Speech Recognition setup popup                 | OPEN  | Quick documentation fix. Good first issue.                                             |
| [#6585](https://github.com/Kilo-Org/kilocode/issues/6585) | 001 (s.replace is not a function error)                       | OPEN  | Bug with unclear reproduction. Needs investigation.                                    |
| [#6418](https://github.com/Kilo-Org/kilocode/issues/6418) | Qwen3-coder-next wrong format of todo list                    | OPEN  | Model-specific rendering issue. Not blocking beta.                                     |

---

## Recommendations

### 1. Clean Up the Board

- **Archive the 8 closed issues** listed in the "Already-Resolved Issues" section. Keeping them visible on the board adds noise and makes it harder to assess remaining work.

### 2. Introduce Explicit Priority Labels

- The board currently relies on `blocking` as the only priority signal. Consider adding `P0`, `P1`, `P2`, `P3` labels to make triage faster and more transparent. Map the current implicit priorities:
  - `blocking` -> P0
  - Bugs affecting core workflow -> P1
  - Feature parity with legacy extension -> P1
  - UX polish and enhancements -> P2
  - Community proposals and advanced features -> P3

### 3. Define a "Beta Blocker" Milestone or Label

- Create a `beta-blocker` label or a "Beta Release" milestone to clearly separate what must ship from what can wait. The current board makes it hard to tell at a glance what the beta critical path is.

### 4. Beta-Critical Issues (Recommended Must-Fix)

Based on this analysis, the following **10 issues** should be considered beta blockers:

| #     | Title                                                     | Reason                                 |
| ----- | --------------------------------------------------------- | -------------------------------------- |
| #6221 | Markdown syntax highlighting blocks main thread for 2.3s+ | Core UX -- UI freezes are unacceptable |
| #6203 | Extension host terminated unexpectedly (SIGILL)           | Crash on task creation on Ubuntu       |
| #6145 | Infinite render loop in ModelPicker                       | Crash in model selection               |
| #6086 | Extension does not refresh on restart/update              | Stale UI after updates                 |
| #6594 | Sessions lost between restarts                            | Data loss                              |
| #6552 | LLM.stream requests leak into subsequent sessions         | Incorrect model routing                |
| #6377 | Model Override not agent-specific                         | Functional bug                         |
| #6082 | Implement anonymous signin prompts                        | Monetization/conversion gate           |
| #6188 | Onboarding for upgrading users                            | Retention for existing users           |
| #6068 | Implement Provider Settings                               | BYOK users can't configure providers   |

### 5. Quick Wins Worth Including in Beta

- **#6081** -- Fix context compression icon (good first issue, small effort, high UX impact)
- **#6051** -- Fix broken speech recognition link (documentation fix)
- **#6250** -- Make new task/escape task clearer (feature parity, usability)
- **#6256** -- Show terminal command execution in UI (transparency/trust)

### 6. Safely Deferrable to Post-Beta

The following features can be deferred without impacting beta viability:

- Autocomplete (#6064)
- Agent Manager multi-session support (#6073)
- Codebase indexing (#6144)
- Session migration (#6090)
- Marketplace support (#6067)
- File attachments (#6078)
- Custom OpenAI-Compatible Provider UI (#6163)
- Agent-scoped MCP filtering (#6060)
- Learn Mode agent (#6120)
- Redo previous message (#6072)
