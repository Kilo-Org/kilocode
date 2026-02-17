# Spec 02: Per-Session Model and Mode Selection

**Depends on:** nothing (independent of worktree spec)

## Goal

Each Agent Manager session has its own independently selected model and agent mode (Code, Ask, etc.). Changing the model or mode in one session does not affect other sessions. This requires a small server API change plus webview-side session isolation.

## Problem

Currently `kilo serve` applies model and agent globally via config. The `POST /session/:id/message` body already accepts `model: { providerID, modelID }` and `agent` fields per-message, but the sidebar's `ModelSelector` and `ModeSwitcher` write to shared state that bleeds across sessions.

The Agent Manager needs each session to carry its own ephemeral model/mode selection that only applies to that session.

## Investigation Required

Before implementing, check with the backend team whether `POST /session` can accept initial `model` and `agent` defaults, or whether per-message overrides are sufficient. Look at:

- `packages/opencode/src/server/` — session creation endpoint
- `packages/kilo-vscode/src/services/cli-backend/http-client.ts` — `createSession()` and `sendMessage()` signatures
- `packages/kilo-vscode/webview-ui/src/context/session.tsx` — `pendingModelSelection` and how model/agent are passed on `sendMessage`

## What to Build

### Option A: Per-message overrides (no server change)

The Agent Manager stores `Map<sessionId, { providerID, modelID, agent }>` in `AgentManagerProvider`. When the webview sends a `sendMessage` for a given session, the provider injects the stored model/agent into the HTTP call. The webview shows per-session model/mode selectors that post `agentManager.setSessionModel` and `agentManager.setSessionMode` messages.

### Option B: Session-level defaults on the server (server change needed)

Extend `POST /session` to accept `model` and `agent` defaults. All subsequent messages in that session use those defaults unless overridden. This is cleaner but requires a server PR first.

Coordinate with the backend team on which option to pursue. Document the decision in this spec before implementing.

## Files to Modify

### `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`

- Session list items show the current model name and mode badge
- Clicking a session shows its model/mode selectors (either reuse `ModelSelector`/`ModeSwitcher` from sidebar, or build minimal custom ones)
- Model/mode changes post new message types to the extension: `agentManager.setSessionModel` and `agentManager.setSessionMode`

### `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`

- Handle `agentManager.setSessionModel` and `agentManager.setSessionMode` messages
- Store per-session model/mode in the metadata map
- Inject stored model/mode into `httpClient.sendMessage()` calls for that session

## Notes

- The existing `ModelSelector` and `ModeSwitcher` components in the sidebar write to shared `SessionProvider` state — do NOT reuse them directly inside the Agent Manager without isolating their state per session
- Model/mode selections are ephemeral (not persisted across restarts) for now
