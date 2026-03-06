# Agent Manager Native Tools + SDK Plan

## Problem

CLI agents in orchestrator mode cannot directly create and manage Agent Manager sessions. Session/worktree orchestration still sits in the VS Code extension. We need one server-owned API that supports:

- launching isolated worktree sessions
- launching multiple versions in parallel (different models/agents)
- tracking status
- reading diffs in a pageable way

The same API should power native CLI tools and SDK clients.

## Goals

1. Native agent tools first (no MCP/security/process complexity in v1)
2. Server owns lifecycle and state (no duplicated orchestration logic)
3. Single simple API for single-run and multi-version launches
4. Multiple versions with per-version model/agent overrides
5. Agent Manager auto-opens when server-created sessions appear

## Non-Goals

- Merge/apply automation (user applies manually in Agent Manager UI)
- PR creation endpoints
- Replacing Agent Manager UI/terminal UX

---

## Architecture

```
CLI Orchestrator (native tools)
        |
        | in-process tool calls
        v
kilo serve
  └─ agent-manager service + routes
        |
        ├─ SDK codegen (`script/generate.ts`)
        |
        └─ VS Code Agent Manager (migrates to SDK routes)
```

### Source of truth

The server is the source of truth for managed sessions and worktrees.

- The server decides worktree location and branch naming.
- The client does **not** compute or own worktree paths.
- Every create/list/status response returns canonical IDs and metadata.

---

## Canonical Data Model

All managed-session APIs return these IDs and metadata:

```json
{
  "sessionID": "session_xxx",
  "groupID": "group_xxx",
  "worktree": {
    "id": "wt_xxx",
    "path": "/abs/path",
    "branch": "opencode/feature-a",
    "baseBranch": "main"
  },
  "agent": "code",
  "model": "provider/model",
  "label": "variant-a",
  "status": "busy"
}
```

Notes:

- `groupID` is present for multi-version launches and optional for single launches.
- `worktree.id` is stable and should be used by clients; `worktree.path` is informational.

---

## Phase 1 (Ship First): Server Endpoints + Native Tools

New server route file:

- `packages/opencode/src/kilocode/server/routes/agent-manager.ts`

New shared service:

- `packages/opencode/src/kilocode/agent-manager/service.ts`
- `packages/opencode/src/kilocode/agent-manager/types.ts`

Native tools call `service.ts` directly. HTTP routes also call `service.ts`.

### API surface (simple + supports multi-version)

#### `POST /agent-manager/session`

Single endpoint for single launch, model variants, and parallel delegated subtasks.

Single launch:

```json
{
  "prompt": "implement X",
  "baseBranch": "main",
  "agent": "code",
  "model": "openai/gpt-5.3-codex"
}
```

Multi-version launch (same prompt, different models):

```json
{
  "prompt": "implement X",
  "baseBranch": "main",
  "versions": [
    { "label": "v1", "model": "openai/gpt-5.3-codex" },
    { "label": "v2", "model": "anthropic/claude-sonnet-4" },
    { "label": "v3", "model": "google/gemini-2.5-pro" }
  ]
}
```

Parallel delegated launch (different prompts per agent):

```json
{
  "baseBranch": "main",
  "versions": [
    {
      "label": "api",
      "prompt": "Implement backend API and data model for feature X",
      "model": "openai/gpt-5.3-codex"
    },
    {
      "label": "ui",
      "prompt": "Implement UI and client integration for feature X",
      "model": "anthropic/claude-sonnet-4"
    },
    {
      "label": "tests",
      "prompt": "Add integration tests and edge-case coverage for feature X",
      "model": "google/gemini-2.5-pro"
    }
  ]
}
```

Rules:

- If `versions` is omitted, create one session.
- If `versions` is present, create one session per version.
- Top-level `prompt`/`agent`/`model` act as defaults; per-version values override.
- `versions[].prompt` enables delegated subtasks in one request.
- `prompt` is optional when every version provides its own prompt.
- Cap versions per request (recommendation: max 4, aligned with current Agent Manager UX).

Response:

```json
{
  "groupID": "group_xxx",
  "sessions": [
    {
      "sessionID": "session_a",
      "worktree": { "id": "wt_a", "path": "...", "branch": "...", "baseBranch": "main" },
      "agent": "code",
      "model": "openai/gpt-5.3-codex",
      "label": "v1",
      "status": "busy"
    }
  ]
}
```

Implementation flow per version:

1. `Worktree.create({ baseBranch })`
2. `Instance.provide({ directory: worktreePath }, ...)`
3. `Session.create({ platform: "agent-manager", permission })`
4. Resolve per-version input:
   - `resolvedPrompt = version.prompt ?? input.prompt`
   - `resolvedAgent = version.agent ?? input.agent`
   - `resolvedModel = version.model ?? input.model`
5. `SessionPrompt.prompt(sessionID, resolvedPrompt, { agent: resolvedAgent, model: resolvedModel })` (async)
6. Emit `agent-manager.session.created`

#### `GET /agent-manager/session`

List managed sessions with filters.

Query params:

- `groupID?`
- `status?` (`idle|busy|error`)
- `limit?`
- `cursor?`

Response includes `sessionID`, `groupID`, `worktree`, `agent`, `model`, `label`, `status`, `time`.

#### `GET /agent-manager/session/:id`

Detailed session view.

Response includes:

- canonical metadata (`sessionID`, `groupID`, `worktree`, etc.)
- `status`
- latest messages (bounded)

#### `DELETE /agent-manager/session/:id`

Abort running session (if needed) and remove worktree.

#### `GET /agent-manager/session/:id/diff`

Pageable diff endpoint to keep context usage bounded.

Query params:

- `cursor?`
- `limit?` (default 20)
- `includePatch?` (default `false`)

Response:

```json
{
  "files": [
    {
      "path": "src/foo.ts",
      "status": "modified",
      "additions": 10,
      "deletions": 2,
      "patch": "...optional/truncated...",
      "patchTruncated": true
    }
  ],
  "summary": { "totalFiles": 3, "totalAdditions": 22, "totalDeletions": 5 },
  "cursor": "next_cursor"
}
```

Default behavior (`includePatch=false`) returns metadata-only file list for low token usage.

---

## Native Tool Surface

New tool files in `packages/opencode/src/kilocode/tool/`:

- `agent-session-create.ts` / `.txt`
- `agent-session-list.ts` / `.txt`
- `agent-session-status.ts` / `.txt`
- `agent-session-cancel.ts` / `.txt`
- `agent-session-diff.ts` / `.txt`

### Tool contracts

`agent_session_create` supports both single and multi-version input:

```json
{
  "prompt": "...",
  "baseBranch": "main",
  "versions": [
    { "label": "api", "prompt": "build backend for X", "model": "..." },
    { "label": "ui", "prompt": "build frontend for X", "model": "..." },
    { "label": "tests", "prompt": "add tests for X", "model": "..." }
  ]
}
```

This is enough for "feature X with 2-3 agents in parallel": one tool call can start all agents, each in its own worktree, with distinct prompts and models.

Other tools stay simple:

- `agent_session_list({ groupID?, status?, limit?, cursor? })`
- `agent_session_status({ sessionID })`
- `agent_session_cancel({ sessionID })`
- `agent_session_diff({ sessionID, cursor?, limit?, includePatch? })`

Register in `packages/opencode/src/tool/registry.ts` and allow in orchestrator permissions in `packages/opencode/src/agent/agent.ts`.

---

## Orchestrator Behavior

Update `packages/opencode/src/agent/prompt/orchestrator.txt` so the model uses multi-version launches correctly.

Expected pattern:

1. Call `agent_session_create` once with `versions[]` when asking for multiple implementations/models.
   - For delegated parallel work, set different `versions[].prompt` values.
2. Poll with `agent_session_list` (optionally by `groupID`).
3. Inspect each with `agent_session_diff` (metadata first, patch only when needed).
4. If corrections are needed in v1, cancel and relaunch a variant.
5. Report options to user for manual apply in Agent Manager UI.

---

## VS Code: Auto-Open Agent Manager

Requirement: if agent-session tools are used and Agent Manager is not open, open it automatically.

### Mechanism

1. Server emits `agent-manager.session.created` (with `sessionID`, `groupID`, `worktree.id`, `worktree.path`, `branch`, `baseBranch`, `model`, `label`).
2. Extension listens to this event in `AgentManagerProvider`.
3. On event:
   - call `openPanel()`
   - register/adopt the session in local state by `worktree.id` + `sessionID`
   - call `registerWorktreeSession(sessionID, worktree.path)`
   - `pushState()`
4. On panel initialization, call `client.agentManager.session.list()` and adopt any missing sessions.

This guarantees visibility for server-created sessions even when the panel was closed.

---

## Implementation Order

1. Add `agent-manager/service.ts` + `types.ts`
2. Add agent-manager server routes
3. Run `script/generate.ts` (SDK regen)
4. Add native tools + registry + orchestrator permissions
5. Add SSE event + extension auto-open/adopt behavior
6. Add multi-version support end-to-end (`versions[]`, `groupID`)

V1 is complete after steps 1-6: native CLI tools can launch single or multi-version sessions with different models, and Agent Manager opens automatically and tracks them.
