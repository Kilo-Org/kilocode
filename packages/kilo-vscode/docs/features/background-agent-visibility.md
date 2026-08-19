# Background Agent Visibility

**Priority:** P1

Background subagents are enabled by default, so a session can have several async agents running at once. The parent transcript shows a task card while the agent runs and injects the result when it finishes, but the card scrolls away. Once it is off screen there is no way to see that agents are still running, how many, or what they are doing.

The CLI already solves this. It keeps a per-session subagent list with status (`running`, `done`, `cancelled`, `error`), shows a `subagents` hint in the status line, and opens a subagent inspector tab. See `packages/opencode/src/cli/cmd/run/subagent-data.ts` and `footer.command.tsx`.

## Goal

Give the VS Code extension the same observability, without inventing a new viewer. Clicking an agent must keep landing in the surfaces users already have:

- Agent Manager: the shared right-hand inspector (`SubagentPanel`), reached with the `agentManager.openSubagent` event.
- Sidebar and Kilo tab: a dedicated editor tab, reached with the `openSubAgentViewer` message.

## Placement

The indicator goes in the **task header strip slot**, directly above the existing to-do strip in `TaskHeader.tsx`.

```
┌──────────────────────────────────────────────┐
│ Upstream background agents…   $6.72  26%  ⌄  │  session header
├──────────────────────────────────────────────┤
│ ⟳ 3 agents                               ⌄  │  NEW strip, collapsed
├──────────────────────────────────────────────┤
│ ⌗ 0/1 to-dos done                        ⌃  │  existing to-do strip
├──────────────────────────────────────────────┤
│  …transcript…                                │
```

```
├──────────────────────────────────────────────┤
│ ⟳ 3 agents                               ⌃  │
│   ⟳ Refactor task registry              ↗   │
│   ⟳ Audit dependency versions           ↗   │
│   ⟳ Research meaning of life            ↗   │
├──────────────────────────────────────────────┤
```

Why this slot:

- The to-do strip already proves the pattern: conditional, collapsible, sticky, one line when collapsed, full width when open.
- It costs zero vertical space when no agent runs.
- It cannot scroll away, which is the actual defect.
- `TaskHeader` is shared through `ChatView`, so the sidebar, the Kilo tab, and Agent Manager all get it.

Rejected: the action row above the composer (`ChatView.renderActions`). It is already full in a narrow sidebar, its buttons appear and disappear with session status, and it is an actions row rather than a status row.

## State source

No new backend route and no new extension service. The data is already in the webview:

| Need | Source |
|---|---|
| the current session's task parts | `session.getSessionToolParts(id)`, the per-session tool index |
| child session id, description, `background` flag | `task` tool part metadata, same lookup order as `childID()` |
| live running state | `session.allStatusMap()`, which covers child sessions |
| child sessions stay tracked while the card is closed | `KiloProvider` auto-adopts them from task parts |

The per-session tool index matters for correctness, not only cost. `allParts()` holds the parts of every loaded session, so deriving from it would make one session's strip list agents started by another session, which is wrong in Agent Manager where several sessions are loaded at once. The index is keyed by session, so the strip lists only agents this session started. Agents started by a sub-agent appear in that sub-agent's own header, not in the root strip.

An agent counts as running only when its child session status is `busy` or `retry`. This fails closed: a stale `running` part from a previous backend process does not produce a phantom spinner.

## Implementation

1. `webview-ui/src/components/chat/open-subagent.ts`
   Shared helper holding the Agent Manager vs sidebar branch. Extracted from `TaskToolExpanded.openInTab` so the task card and the strip cannot drift apart.
2. `webview-ui/src/components/chat/background-agents.ts`
   Pure derivation: `backgroundAgents(parts, status)` returns running background agents, deduplicated by child session id, in transcript order.
3. `webview-ui/src/components/chat/BackgroundAgents.tsx`
   The strip. Collapsed by default, reuses the `task-header-todos-*` slots, opens an agent through the shared helper.
4. `TaskHeader.tsx` renders `<BackgroundAgents />` above the to-do strip.
5. `styles/task-header.css` adds `[data-component="task-header-agents"]`.
6. `i18n/en.ts` adds `task.backgroundAgents.*`. Other locales fall back to English, because non-English dictionaries are `Partial`.
7. `tests/unit/background-agents.test.ts` covers the derivation with real part shapes.

## Concurrency

Opening an agent from the strip while its task card is also open is safe. `VisibleTaskStreams` refcounts stream visibility per session, and only `visible: false` releases a child session, so two openers cannot cut each other's stream.

The strip itself does not sync any child session. It only reads status, so listing agents stays cheap and full part streaming happens on open.

## Known limit

The webview only knows sessions it has loaded. After a webview reload, an agent whose parent session is not loaded again will not be listed, although it keeps running and still delivers its result into the parent transcript.

If that gap matters in practice, the fix is a Kilo-owned `GET` returning `BackgroundJob.list()` under `packages/opencode/src/kilocode/server/httpapi/`, which needs no changes to shared upstream files. Not built yet, deliberately.

## Follow-ups

- **Permission attribution.** With several agents running, each blocked agent produces an anonymous permission prompt. Prompts should name the agent and expose a `1 of N` queue, matching `FooterSubagentState.permissions` in the CLI. This is the most valuable follow-up.
- **Per-row cancel.** Abort the child session, which already cancels the job through `SessionRunState.cancel`.
- **Elapsed time per row.** Needs a ticking timer, deferred to keep the first version free of re-render cost.
- **Keybindings for CLI parity.** `kilo-code.new.viewBackgroundAgents` (CLI `session.child.first`) and `kilo-code.new.backgroundSubagents` (CLI `session.background`).
- **Finished agents.** Currently the row disappears when the agent finishes, because the completion text is injected into the parent transcript. Revisit only if users report missing the transition.
