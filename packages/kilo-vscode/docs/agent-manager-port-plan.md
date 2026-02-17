# Agent Manager Port Plan: Sidebar v2 Sessions

Port the Agent Manager from `kilocode` to `kilo-vscode`, replacing the custom agent-runtime subprocess model with the existing sidebar webview (Mark's SolidJS app) backed by `kilo serve`.

---

## Status

| Phase               | Status | Notes                                   |
| ------------------- | ------ | --------------------------------------- |
| Investigation       | DONE   | Both codebases explored, plan validated |
| Phase 1: Foundation | TODO   |                                         |
| Phase 2: Worktrees  | TODO   |                                         |
| Phase 3: Lifecycle  | TODO   |                                         |
| Phase 4: Polish     | TODO   |                                         |

---

## Context: What Already Exists

### The Sidebar (Mark's Implementation)

The sidebar at `webview-ui/src/` is a complete SolidJS chat application. It already provides:

- **Full chat UI**: `ChatView` with `MessageList`, `Message`, `PromptInput`, `TaskHeader`, `ModelSelector`, `ModeSwitcher`, `QuestionDock`
- **Session management**: `SessionProvider` with create, switch, load messages, delete, rename, clear
- **Streaming**: Real-time part updates via SSE events through `KiloProvider`
- **Permissions**: Permission request/response flow with inline UI
- **Model/agent selection**: Per-session model and agent picking
- **History**: `SessionList` grouped by date
- **Settings**: 14+ settings tabs
- **Profile/auth**: Login, org switching, device auth

### How It Communicates

The sidebar uses `acquireVsCodeApi().postMessage()` to send messages to the extension host. The extension host (`KiloProvider.ts`) translates these into HTTP calls to `kilo serve` and subscribes to SSE events, forwarding them back to the webview.

```
SolidJS webview <--postMessage--> KiloProvider <--HTTP/SSE--> kilo serve
```

Each `KiloProvider` instance maintains a `trackedSessionIds` set so it only receives SSE events for its own sessions.

### The Backend

`kilo serve` is the CLI backend. It supports:

- Multiple concurrent sessions via `POST /session` scoped by `x-opencode-directory` header
- Per-request working directory (the middleware reads `x-opencode-directory` on every request)
- SSE events with session IDs for routing
- Per-session permissions via the `permission` field in `POST /session`

### Configuration Flow (Current)

Configuration flows through several layers:

1. **Global config**: `GET /config` returns merged config (global + project). Settings UI writes via `PATCH /global/config`. Covers permissions, model defaults, agents, MCP, experimental flags, etc.

2. **Per-message model/agent override**: When the user sends a message, `POST /session/:id/message` accepts `model: { providerID, modelID }` and `agent` fields. The sidebar passes these from its `ModelSelector` and `ModeSwitcher` components.

3. **Per-session permissions**: `POST /session` accepts a `permission` field (`PermissionRuleset`: array of `{ permission, pattern, action }` rules). Currently the extension sends an **empty body** at session creation -- no per-session permissions are configured.

4. **Per-message system prompt**: `POST /session/:id/message` accepts a `system` field for custom system prompt additions. Not currently used by the extension.

5. **Working directory**: Every request sends `x-opencode-directory` header. The server resolves project context, config, and file operations relative to this directory.

**For the Agent Manager**, this means:

- Model and agent are passed with the first `POST /session/:id/message` call (already supported)
- Per-session permissions can be set at session creation via `POST /session` body (currently unused, available for future use)
- Working directory (workspace or worktree) is controlled per-request via `x-opencode-directory`
- Global config (permission rules, provider settings) applies to all sessions on the same `kilo serve` instance

---

## Architecture

Each Agent Manager session renders the sidebar SolidJS app in its own iframe within a single Agent Manager panel. The sidebar's `VSCodeProvider` is modified to detect iframe context and bridge `postMessage` through the parent frame.

```
+-----------------------------------------------------------+
|           Agent Manager Panel (editor tab)                 |
|           SolidJS webview (agent-manager entry point)      |
|                                                            |
|  +==============+  +====================================+ |
|  | Session       |  | Session Detail                     | |
|  | Sidebar       |  |                                    | |
|  |               |  |  +------------------------------+  | |
|  | [+ New Agent] |  |  | Sidebar (SolidJS)             |  | |
|  |               |  |  | embedded via <iframe srcdoc>  |  | |
|  | Session 1 *   |  |  |                              |  | |
|  | Session 2 o   |  |  | Full chat UI, permissions,   |  | |
|  | Session 3 v   |  |  | tools, streaming, model      |  | |
|  |               |  |  | selector -- all from sidebar  |  | |
|  |               |  |  |                              |  | |
|  |               |  |  +------------------------------+  | |
|  |               |  |                                    | |
|  |               |  |  [Worktree: feature/auth-flow]     | |
|  |               |  |  [Terminal] [Finish to Branch]     | |
|  +==============+  +====================================+ |
+-----------------------------------------------------------+
         |                       |
         | postMessage           | iframe postMessage
         v                       v
+----------------------------------------------+
|  AgentManagerProvider (extension host)         |
|                                                |
|  AgentSessionManager                           |
|    +-- session registry (Map<id, AgentSession>)|
|    +-- SSE event routing (per-session)         |
|    +-- KiloConnectionService (shared)          |
|    |   +-- ServerManager (shared kilo serve)   |
|    |   +-- HttpClient (sessions, worktrees)    |
|    +-- WorktreeManager (git worktrees)         |
|    +-- SessionTerminalManager (vscode terms)   |
|    +-- message bridge (per-session routing)     |
+--------------------+-------------------------+-+
                     | HTTP/SSE (Basic Auth)
                     v
                kilo serve
             (one shared instance)
```

### Why iframes

- The sidebar is SolidJS -- can't mix SolidJS components into another SolidJS app tree without shared context
- Each iframe gets a fully isolated sidebar instance with its own `SessionProvider`, `ConfigProvider`, etc.
- The sidebar is already designed for `postMessage` communication -- iframe `postMessage` is structurally identical
- Each session's sidebar stays in sync with upstream -- no fork divergence
- The sidebar encapsulates all chat complexity (streaming, permissions, tools, model selection)

### Message Flow

```
User types in iframe chat input
  |
  v
SolidJS sidebar (iframe) calls api.postMessage({ type: "sendMessage", ... })
  |
  | The mock fallback calls window.parent.postMessage({ type: "sendMessage", ... }, "*")
  v
Agent Manager webview receives via window.addEventListener("message")
  | Identifies which iframe sent it (event.source === iframeRef.contentWindow)
  |
  | vscode.postMessage({ type: "agentManager.sidebarMessage", sessionId, payload })
  v
AgentManagerProvider.handleMessage() in extension host
  |
  | Translates sidebar message type -> httpClient call
  | e.g. "sendMessage" -> httpClient.sendMessage(sessionId, parts, directory)
  v
kilo serve processes message, runs LLM + tools
  |
  | SSE events: message.part.updated, session.status, permission.asked, etc.
  v
AgentManagerProvider SSE listener filters by managed session IDs
  |
  | panel.webview.postMessage({ type: "agentManager.sidebarEvent", sessionId, payload })
  v
Agent Manager webview receives, routes to correct iframe
  |
  | iframe.contentWindow.postMessage(payload, "*")
  v
SolidJS sidebar (iframe) receives via window.addEventListener("message")
  | VSCodeProvider processes event.data as an ExtensionMessage (unchanged)
```

### Configuration Flow for Agent Sessions

When the Agent Manager creates a new session:

1. **Working directory**: If worktree mode, the `WorktreeManager` creates a worktree at `{projectRoot}/.kilocode/worktrees/{branch}/`. All HTTP requests for this session use `x-opencode-directory` pointing to the worktree path. If local mode, uses the workspace directory.

2. **Session creation**: `POST /session` with `x-opencode-directory` set to the working directory. The server creates the session scoped to that directory's project context.

3. **Model and agent**: Passed with the first `POST /session/:id/message` call as `model: { providerID, modelID }` and `agent` fields. The sidebar's built-in `ModelSelector` and `ModeSwitcher` also work within the iframe -- the user can change model/agent mid-session.

4. **Global config**: All sessions share the same `kilo serve` instance, so global config (from `GET /config` / `PATCH /global/config`) applies to all sessions. Settings changed in one session's iframe affect all sessions. This is the expected behavior -- users configure their tools once.

5. **Initial prompt**: The Agent Manager sends the user's prompt as the first message via `POST /session/:id/message`. The sidebar iframe receives SSE events and renders the streaming response.

```
Agent Manager "New Agent" form:
  Prompt: "Add authentication with OAuth2"
  Model:  anthropic / claude-sonnet-4-20250514
  Agent:  code
  Mode:   Worktree

AgentManagerProvider:
  1. WorktreeManager.createWorktree("Add authentication with OAuth2")
     -> branch: add-authentication-with-oauth2-1708000000000
     -> path: /project/.kilocode/worktrees/add-authentication-with-oauth2-1708000000000/

  2. httpClient.createSession(worktreePath)
     -> POST /session, x-opencode-directory: /project/.kilocode/worktrees/...
     -> returns { id: "ses_abc123", ... }

  3. httpClient.sendMessage("ses_abc123", parts, worktreePath, {
       providerID: "anthropic",
       modelID: "claude-sonnet-4-20250514",
       agent: "code",
     })
     -> POST /session/ses_abc123/message
     -> body: { parts: [{ type: "text", text: "Add authentication with OAuth2" }],
                model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
                agent: "code" }

  4. Open iframe with sidebar connected to ses_abc123
     -> SSE events stream in, sidebar renders chat
```

---

## Implementation Plan

### Phase 1: Foundation

**Goal**: Agent Manager panel opens, shows session list, can create a new session that renders the sidebar in an iframe with working chat.

#### 1.1 Run sidebar in an iframe

The sidebar communicates exclusively via `postMessage`. It calls `acquireVsCodeApi()` to get the API, then uses `api.postMessage()` to send and `window.addEventListener("message")` to receive.

Inside an iframe, `acquireVsCodeApi` is undefined. The sidebar's `vscode.tsx` already has an else branch for this case (a mock that logs to console). We modify that fallback to bridge to the parent frame instead:

**File**: `webview-ui/src/context/vscode.tsx` (modify mock fallback)

```typescript
// Current (line 20-22):
vscodeApi = {
  postMessage: (msg) => console.log("[Kilo New] Mock postMessage:", msg),
  getState: () => undefined,
  setState: () => {},
}

// Changed to:
vscodeApi = {
  postMessage: (msg) => window.parent.postMessage(msg, "*"),
  getState: () => undefined,
  setState: () => {},
}
```

That's the only sidebar change. When the sidebar loads in an iframe, `acquireVsCodeApi` is undefined, so it uses this fallback. All `postMessage` calls go to `window.parent` (the Agent Manager webview).

**Inbound messages** (extension -> sidebar): The Agent Manager webview calls `iframe.contentWindow.postMessage(extensionMessage, "*")`. The sidebar's existing `window.addEventListener("message")` in `VSCodeProvider` picks these up and processes `event.data` as an `ExtensionMessage`. No changes needed for this direction.

**Outbound messages** (sidebar -> extension): The sidebar calls `api.postMessage(msg)` which goes to `window.parent.postMessage(msg, "*")`. The Agent Manager webview listens for these and forwards them to the extension host with the session ID attached.

#### 1.2 Agent Manager extension host

**File**: `src/agent-manager/types.ts` (new)

```typescript
interface AgentSession {
  id: string // kilo serve session ID
  label: string
  status: "creating" | "busy" | "idle" | "error"
  created: number
  directory: string // Working directory (workspace or worktree path)
  worktree?: {
    branch: string
    path: string
    parentBranch: string
  }
  model?: { providerID: string; modelID: string }
  agent?: string
}

// Overview webview -> Extension
type AgentManagerMessage =
  | { type: "agentManager.ready" }
  | {
      type: "agentManager.createSession"
      prompt: string
      model?: ModelSelection
      agent?: string
      worktree?: boolean
      copies?: number
    }
  | { type: "agentManager.stopSession"; sessionId: string }
  | { type: "agentManager.deleteSession"; sessionId: string }
  | { type: "agentManager.selectSession"; sessionId: string }
  | { type: "agentManager.openTerminal"; sessionId: string }
  | { type: "agentManager.finishToBranch"; sessionId: string }
  | { type: "agentManager.sidebarMessage"; sessionId: string; payload: any }

// Extension -> Overview webview
type AgentManagerEvent =
  | { type: "agentManager.sessions"; sessions: AgentSession[] }
  | { type: "agentManager.sessionCreated"; session: AgentSession }
  | { type: "agentManager.sessionUpdated"; session: AgentSession }
  | { type: "agentManager.sessionDeleted"; sessionId: string }
  | { type: "agentManager.sidebarEvent"; sessionId: string; payload: any }
  | { type: "agentManager.sidebarHtml"; html: string }
  | { type: "agentManager.error"; message: string }
```

**File**: `src/agent-manager/AgentSessionManager.ts` (new)

Session registry and lifecycle:

- `sessions: Map<string, AgentSession>` -- in-memory registry
- `createSession(prompt, opts)` -- creates session on server, returns session info
- `stopSession(id)` -- calls `httpClient.abortSession()`
- `deleteSession(id)` -- calls `httpClient.deleteSession()`, cleans up worktree if applicable
- SSE event subscription: listens for `session.status`, `session.turn.close` across all managed sessions to update status

**File**: `src/agent-manager/AgentManagerProvider.ts` (rewrite existing stub)

- Constructor takes `extensionUri`, `connectionService`, `context`
- Opens `WebviewPanel` for the Agent Manager (SolidJS-based overview + iframes)
- Handles messages from the overview webview (session create/stop/delete/select)
- Handles `agentManager.sidebarMessage` -- routes sidebar messages to `kilo serve` via `KiloConnectionService`
- Routes SSE events back as `agentManager.sidebarEvent` to the correct iframe
- Generates sidebar HTML (reads `dist/webview.js` + `dist/webview.css`, inlines into a template) for iframe `srcdoc`
- Acts as a **message router** between each iframe and `kilo serve`, similar to what `KiloProvider` does for a single sidebar

#### 1.3 Modify extension.ts

**File**: `src/extension.ts` (modify)

```typescript
// Before:
const agentManagerProvider = new AgentManagerProvider(context.extensionUri)

// After:
const agentManagerProvider = new AgentManagerProvider(context.extensionUri, connectionService, context)
```

#### 1.4 Agent Manager webview (SolidJS)

The overview panel is a **separate SolidJS entry point** using `@kilocode/kilo-ui` components. It renders:

- Session list with status badges
- "New Agent Session" button / form (prompt, model, agent, worktree toggle, copy count)
- Per-session actions: select (show iframe), stop, delete, terminal
- Selected session renders the sidebar iframe

**File**: `webview-ui/agent-manager/index.tsx` (new SolidJS entry)
**File**: `webview-ui/agent-manager/AgentManagerApp.tsx` (root component)
**File**: `webview-ui/agent-manager/components/SessionSidebar.tsx` (session list)
**File**: `webview-ui/agent-manager/components/SessionDetail.tsx` (iframe container or new-agent form)
**File**: `webview-ui/agent-manager/components/SidebarFrame.tsx` (iframe + postMessage bridge)
**File**: `webview-ui/agent-manager/components/NewAgentForm.tsx` (prompt, model, agent, mode selectors)

#### 1.5 iframe postMessage bridge (in SidebarFrame.tsx)

The `SidebarFrame` component renders `<iframe srcdoc={sidebarHtml} />` and manages the bidirectional message bridge:

```typescript
// Outbound: sidebar iframe -> extension host
// The sidebar's mock fallback calls window.parent.postMessage(msg, "*").
// We identify the source iframe by checking event.source against our iframe refs.
window.addEventListener("message", (event) => {
  // Find which session's iframe sent this message
  const sessionId = findSessionByIframeWindow(event.source)
  if (sessionId) {
    vscode.postMessage({
      type: "agentManager.sidebarMessage",
      sessionId,
      payload: event.data,
    })
  }
})

// Inbound: extension host -> sidebar iframe
// The extension sends { type: "agentManager.sidebarEvent", sessionId, payload }.
// We forward the payload directly to the iframe -- the sidebar's
// window.addEventListener("message") processes event.data as an ExtensionMessage.
window.addEventListener("message", (event) => {
  const msg = event.data
  if (msg?.type === "agentManager.sidebarEvent") {
    const iframe = getIframeForSession(msg.sessionId)
    iframe?.contentWindow?.postMessage(msg.payload, "*")
  }
})
```

The sidebar receives raw `ExtensionMessage` objects via `event.data` -- no unwrapping needed. The sidebar sends raw `WebviewMessage` objects via `window.parent.postMessage()` -- the Agent Manager wraps them with the session ID before forwarding to the extension host.

#### 1.6 Build setup

**File**: `esbuild.js` (modify)

Add third build context for the Agent Manager webview:

```javascript
const agentManagerCtx = await esbuild.context({
  entryPoints: ["webview-ui/agent-manager/index.tsx"],
  bundle: true,
  format: "iife",
  minify: production,
  sourcemap: !production,
  platform: "browser",
  outfile: "dist/agent-manager.js",
  logLevel: "silent",
  plugins: [solidDedupePlugin, cssPackageResolvePlugin, solidPlugin(), esbuildProblemMatcherPlugin],
})
```

Same SolidJS pipeline as the sidebar build -- uses `@kilocode/kilo-ui` components.

#### 1.7 CSP and iframe strategy

Use `srcdoc` to avoid CSP `frame-src` issues:

1. Extension host reads `dist/webview.js` and `dist/webview.css` at panel creation
2. Generates a complete HTML document string with inlined `<script>` and `<style>` tags
3. Sends the HTML to the Agent Manager webview via `agentManager.sidebarHtml` message
4. The webview sets it as `iframe.srcdoc`

If `srcdoc` proves too large (the sidebar bundle can be hundreds of KB), fallback to `URL.createObjectURL(new Blob([html], { type: "text/html" }))` as `iframe.src` -- requires adding `frame-src blob:` to CSP.

---

### Phase 2: Worktrees & Parallel Mode

**Goal**: Sessions can run in isolated git worktrees inside the project directory.

#### 2.1 WorktreeManager (port from kilocode)

**File**: `src/agent-manager/WorktreeManager.ts` (port)

Port from `kilocode/src/core/kilocode/agent-manager/WorktreeManager.ts`. Uses `simple-git` for git operations. Worktrees live inside the project directory at `{projectRoot}/.kilocode/worktrees/{branch}/`.

Key operations:

- **`createWorktree(prompt, existingBranch?)`**: Generates branch name from prompt (`{sanitized-slug}-{timestamp}`), runs `git worktree add -b {branch} {path}`. Returns `{ branch, path, parentBranch }`.
- **`removeWorktree(path)`**: Runs `git worktree remove {path}` with `--force` fallback.
- **`discoverWorktrees()`**: Scans `.kilocode/worktrees/` for valid worktree directories, reads branch info and session IDs.
- **`ensureGitExclude()`**: Adds `.kilocode/worktrees/` to `{gitDir}/info/exclude` so worktrees don't pollute git status.
- **`writeSessionId(path, id)` / `readSessionId(path)`**: Writes `{worktree}/.kilocode/session-id` for recovery after extension restart.
- **`stageAllChanges(path)`**: `git add -A` in the worktree.
- **`commitChanges(path, message)`**: Stages + commits.
- **`getWorktreeDiff(path, parentBranch)`**: `git diff {parentBranch}...HEAD`.

Changes from kilocode version:

- Use `simple-git` directly (same library, no changes needed)
- Session ID format uses `kilo serve` session IDs (strings like `ses_abc123`) instead of old agent-runtime IDs

#### 2.2 Worktree + kilo serve integration

When creating a worktree session:

1. `WorktreeManager.createWorktree(prompt)` creates worktree at `{projectRoot}/.kilocode/worktrees/{branch}/`
2. `httpClient.createSession(worktreePath)` creates a `kilo serve` session with `x-opencode-directory` = worktree path
3. `WorktreeManager.writeSessionId(worktreePath, sessionId)` writes session ID for recovery
4. `httpClient.sendMessage(sessionId, parts, worktreePath, { model, agent })` sends the initial prompt
5. The sidebar iframe renders the session -- all file operations happen within the worktree

#### 2.3 SessionTerminalManager (port from kilocode)

**File**: `src/agent-manager/SessionTerminalManager.ts` (port)

Pure VS Code terminal API:

- `showTerminal(sessionId, cwd, label)` -- creates/reveals terminal with `cwd` = worktree path
- Tracks terminals in `Map<string, vscode.Terminal>`
- Cleans up on `vscode.window.onDidCloseTerminal`

#### 2.4 Multi-version mode

Create N worktrees + N sessions with the same prompt:

1. User sets version count in `NewAgentForm`
2. Extension creates N worktrees and N sessions in parallel
3. Each gets a label suffix (v1, v2, v3)
4. All sessions appear in the session list, individually selectable

#### 2.5 "Finish to Branch"

Send a message to the session asking the agent to commit:

```typescript
await httpClient.sendMessage(
  sessionId,
  [
    {
      type: "text",
      text: "Please stage all changes with `git add -A` and commit them with a descriptive commit message.",
    },
  ],
  worktreeDirectory,
)
```

Fallback: use `WorktreeManager.stageAllChanges()` + `commitChanges()` programmatically if the agent doesn't respond.

---

### Phase 3: Session Lifecycle

#### 3.1 Session persistence

On extension restart:

1. `AgentSessionManager` calls `httpClient.listSessions(workspaceDir)` to discover server-side sessions
2. `WorktreeManager.discoverWorktrees()` scans `.kilocode/worktrees/` and reads session ID files
3. Correlates server sessions with worktree metadata
4. Stores Agent Manager metadata in `context.workspaceState` for labels and custom state
5. `kilo serve` persists messages on disk -- message history is intact
6. User can re-open any session from the overview

#### 3.2 Session operations

- **Stop**: `POST /session/:id/abort`
- **Delete**: `DELETE /session/:id` + `WorktreeManager.removeWorktree()` if applicable
- **Rename**: `PATCH /session/:id` with new title
- **Resume**: Select session in overview, iframe loads message history, user can send new messages

#### 3.3 Remote sessions -- deferred

---

### Phase 4: Polish (restore existing features)

These features all existed in the old kilocode Agent Manager and should be ported:

#### 4.1 Status indicators

The old Agent Manager displayed five statuses: `creating`, `running`, `done`, `error`, `stopped`. Map to `kilo serve` events:

- `creating` -> session created but first message not yet sent
- `running` (maps to `session.status: busy`) -> spinning indicator
- `done` (maps to `session.turn.close: completed`) -> green checkmark
- `error` (maps to `session.turn.close: error`) -> red error badge
- `stopped` (maps to user-initiated abort) -> grey stopped icon

#### 4.2 VS Code notifications

The old Agent Manager used `vscode.window.showInformationMessage()` for session completion (with "Copy Branch Name" action) and `vscode.window.showWarningMessage()` for errors. Port the same behavior.

#### 4.3 Telemetry

The old Agent Manager tracked these PostHog events (from `telemetry.ts`):

- `AGENT_MANAGER_OPENED`
- `AGENT_MANAGER_SESSION_STARTED` (with sessionId, useWorktree)
- `AGENT_MANAGER_SESSION_COMPLETED`
- `AGENT_MANAGER_SESSION_STOPPED`
- `AGENT_MANAGER_SESSION_ERROR` (with error string)
- `AGENT_MANAGER_LOGIN_ISSUE` (with issue type + platform diagnostics)

Port these using `@kilocode/kilo-telemetry`.

---

## File Structure

```
packages/kilo-vscode/
+-- src/
|   +-- agent-manager/
|   |   +-- AgentManagerProvider.ts    # Panel + message routing between iframes and kilo serve
|   |   +-- AgentSessionManager.ts     # Session registry + lifecycle
|   |   +-- WorktreeManager.ts         # Git worktree ops (ported from kilocode) (Phase 2)
|   |   +-- SessionTerminalManager.ts  # VS Code terminals (Phase 2)
|   |   +-- types.ts                   # AgentSession, message types
|   +-- extension.ts                   # Modified: pass connectionService to AgentManagerProvider
|   +-- services/cli-backend/
|       +-- http-client.ts             # NO CHANGES (existing API surface is sufficient)
+-- webview-ui/
|   +-- agent-manager/                 # NEW: Agent Manager overview (SolidJS)
|   |   +-- index.tsx                  # SolidJS entry point
|   |   +-- AgentManagerApp.tsx        # Root: session sidebar + session detail area
|   |   +-- components/
|   |   |   +-- SessionSidebar.tsx     # Left panel: session list + new button
|   |   |   +-- SessionDetail.tsx      # Right panel: iframe or new-agent form
|   |   |   +-- SidebarFrame.tsx       # iframe + postMessage bridge
|   |   |   +-- NewAgentForm.tsx       # Prompt, model, agent, worktree selectors
|   |   |   +-- SessionItem.tsx        # Session list item with status badge
|   +-- src/                           # Existing sidebar (SolidJS)
|       +-- context/
|           +-- vscode.tsx             # Modified: mock fallback bridges to window.parent
+-- esbuild.js                         # Modified: add agent-manager build context
```

---

## Resolved Design Questions

### iframe overhead and session independence

Sessions run on `kilo serve`, not inside the iframe. The iframe is purely a UI view -- if the iframe doesn't exist, the session keeps running on the server (LLM calls, tool execution, etc. all continue). SSE events still arrive at the extension host and update session status in the overview.

**Strategy: one iframe at a time, fast switching.**

- Only the selected session has an iframe in the DOM. All other sessions are "headless" -- they run on the server, the Agent Manager tracks their status via SSE, but there's no iframe rendering.
- When the user selects a different session, the current iframe is destroyed and a new one is created for the selected session.
- The new iframe loads, the sidebar calls `loadMessages` (via the postMessage bridge), and the extension responds with the full message history from `GET /session/:id/message`. The sidebar renders it.
- Switching cost = iframe creation + message history fetch + render. For typical sessions this is fast (messages are already in memory on the server, the HTTP round-trip is local).

**Why this works:**

- Sessions are fully independent -- they don't share any iframe state. One session's iframe being created/destroyed has zero effect on other sessions.
- No memory accumulation from cached iframes. With 10 active sessions, only 1 iframe exists at a time.
- Background sessions keep running. The SSE event stream delivers status updates regardless of whether an iframe exists.
- The sidebar already supports this pattern: `selectSession()` loads messages via `loadMessages` and renders the full history. This is the same thing that happens when a user picks a session from the history list.

**If switching feels slow** (unlikely but possible for sessions with very long message histories), we can optimize later by caching the last 2-3 iframes with `display: none` instead of destroying them. But start simple.

### `srcdoc` size

The sidebar bundle (JS + CSS) needs to be inlined into `srcdoc`. If the bundle is too large, fallback to `URL.createObjectURL(new Blob([html], { type: "text/html" }))` as `iframe.src` -- requires adding `frame-src blob:` to CSP. The HTML template is generated once by the extension host and reused for all iframes.

---

## Risk Assessment

| Risk                                         | Impact      | Mitigation                                                                |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| VS Code CSP blocks iframe content            | Blocker     | Use `srcdoc` (no external resources). Test with `blob:` URLs as fallback. |
| Sidebar bundle too large for `srcdoc`        | Performance | Lazy-load iframe on session select. `blob:` URL approach.                 |
| postMessage bridge latency                   | UX          | Messages are small JSON -- latency should be negligible.                  |
| SolidJS context loss on iframe recreation    | UX          | Cache iframes in DOM for active sessions.                                 |
| `simple-git` dependency for WorktreeManager  | Bundle size | `simple-git` is lightweight, extension-side only (Node.js).               |
| Two SolidJS bundles increases extension size | Build       | Agent Manager overview is small. Sidebar bundle is shared via `srcdoc`.   |
