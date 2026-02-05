# Agent prompt: Hook up copied OpenCode chat UI inside the VS Code extension webview

## Context

We have a VS Code extension in [`kilo-vscode/`](kilo-vscode/) with a webview frontend under [`kilo-vscode/webview-ui/`](kilo-vscode/webview-ui/).

I already copied the OpenCode “chat window” UI from the standalone app into the webview under:

- `kilo-vscode/webview-ui/src/opencode-app/…`

The copied code includes (at minimum):

- `opencode-app/pages/session.tsx` (chat timeline page)
- `opencode-app/components/prompt-input.tsx` (prompt composer)
- `opencode-app/context/*` (app contexts)
- `opencode-app/utils/*`, `opencode-app/hooks/*`

Your task is to **wire this UI up so it works inside the VS Code extension**.

## Hard constraints

- Prefer “copy + adapt” over refactors.
- Keep changes focused to the VS Code extension + its webview.
- Do not change the standalone `app/` package.
- Make the chat window functional end-to-end in VS Code.

## Goal

Render the chat UI (session view + prompt input) inside the extension’s webview and connect it to the extension host so:

1. The webview can display the message timeline for the active session.
2. Submitting a prompt sends it to the backend (via the extension host) and streams responses back into the timeline.
3. Abort/cancel works.
4. Session selection is handled (either single session or by id).

## Architecture requirement

### Replace “direct backend calls” with Webview ↔ Extension message passing

The copied app code expects to talk to an OpenCode backend directly (HTTP/WebSocket/etc.). In VS Code, the webview **must not** talk to localhost directly unless we explicitly allow it.

Instead:

- Webview sends typed messages to extension host using `vscode.postMessage`.
- Extension host replies/streams events back using `webview.postMessage`.

Implement a small “transport” layer (request/response + streaming events) and adapt the copied `opencode-app/context/*` to use it.

## Step-by-step tasks

### 1) Locate the webview entrypoint and mount the chat UI

In [`kilo-vscode/webview-ui/src/`](kilo-vscode/webview-ui/src/), find the current entry file (likely `main.tsx` / `index.tsx`).

Add a minimal route-less mount that renders the session UI. You have two options:

**Option A (recommended):** Treat the session UI as a component view

- Create a wrapper component in the webview like `ChatView.tsx` and render it.
- Pass required params (session id, repo/worktree path, etc.) via props or a small local store.
- Avoid depending on the router.

**Option B:** Add router support

- Configure a router and mount `opencode-app/pages/session.tsx` as a route.
- Provide whatever route params it expects.

Pick the simplest approach that compiles and runs.

### 2) Make TypeScript pathing/imports work

The copied code likely uses `@/…` aliases.

Do one of:

- Add a TS/Vite alias in the webview build so `@/…` resolves to `kilo-vscode/webview-ui/src/opencode-app/`.
- Or rewrite imports in copied files to relative imports.

Keep the diff small and consistent.

### 3) Ensure dependencies exist in webview-ui

Verify `kilo-vscode/webview-ui/package.json` includes the runtime deps required by the copied UI:

- `solid-js`
- any Solid router dependency if you use routing
- `@opencode-ai/ui`, `@opencode-ai/util`, `@kilocode/sdk` (or equivalents already used)

If workspace deps are used, ensure the webview bundler can resolve them.

### 4) Define a typed message protocol

Create a shared protocol definition (Typescript types) used by both:

- webview code (`kilo-vscode/webview-ui/src/...`)
- extension host code (`kilo-vscode/src/...`)

If you can’t share TS sources directly, duplicate the types but keep them identical.

Minimum message set:

#### Webview → Extension

- `chat/init` (webview ready, includes view context)
- `chat/loadSession` (session id)
- `chat/sendPrompt` (session id, text, attachments/context)
- `chat/abort` (session id or request id)
- `chat/setModel` (optional)

#### Extension → Webview

- `chat/sessionLoaded` (initial session state + messages)
- `chat/messageAppended` (new assistant/user message)
- `chat/messageDelta` (streaming token delta)
- `chat/requestState` (started/finished/aborted)
- `chat/error` (human readable + debug)

Include `requestId` correlation fields so the webview can match responses.

### 5) Implement the webview-side transport

Add a small client in the webview that:

- wraps `vscode.postMessage` with request/response semantics
- exposes `sendPrompt()`, `loadSession()`, `abort()`
- provides an event emitter / observable for streaming deltas

Integrate it into the copied contexts:

- In `opencode-app/context/sdk.tsx` and `opencode-app/context/sync.tsx` (or whichever files perform IO), replace direct HTTP/WebSocket calls with calls to the transport.

Goal: the UI code continues to think it is talking to a “backend”, but the backend is the extension host.

### 6) Implement the extension-host controller

In extension host code (likely under [`kilo-vscode/src/`](kilo-vscode/src/)):

- Find the webview creation code (panel provider / webview view provider).
- Add a message handler for `webview.onDidReceiveMessage`.
- Route the messages to a `ChatController` class.

The controller should:

- Start/attach to a backend session (however this extension currently interacts with OpenCode)
- Send prompt requests
- Stream deltas back to the webview
- Handle abort

If the extension already has an “agent” manager or CLI bridge, reuse it.

### 7) Session identity and storage

Decide how sessions map in VS Code:

- Single session per workspace? (Simplest)
- Multiple sessions with IDs?

Implement minimal session selection and ensure `session.tsx` gets a session id.

### 8) Remove/disable unsupported UI panels (if needed)

If the copied session page includes:

- file tree
- embedded terminal

and that’s not feasible in the webview initially:

- feature-flag them off
- or stub with placeholders

Prioritize the **message timeline + prompt input** working.

### 9) Styling

Ensure `opencode-app/index.css` is imported by the webview entrypoint, or merged into existing webview CSS.

### 10) Testing

Definition-of-done manual test:

1. Run extension in VS Code Extension Development Host.
2. Open the Kilo/OpenCode webview.
3. Chat UI renders.
4. Typing a prompt + sending shows the user message immediately.
5. Assistant response streams into the timeline.
6. Abort stops streaming and UI returns to idle.
7. No errors in devtools console.

## Deliverables

1. Chat UI renders in the VS Code webview.
2. Message protocol types and transport implementation.
3. Extension-host `ChatController` (or equivalent) that bridges to backend.
4. Minimal glue changes to the copied contexts to use the transport.
5. A short `NOTES.md` in `kilo-vscode/` describing:
   - where the protocol lives
   - how to debug
   - any known limitations

## Guidance: where to start in code

Start by identifying:

- the webview entrypoint in [`kilo-vscode/webview-ui/src/`](kilo-vscode/webview-ui/src/)
- the webview provider in [`kilo-vscode/src/KiloProvider.ts`](kilo-vscode/src/KiloProvider.ts) and/or [`kilo-vscode/src/AgentManagerProvider.ts`](kilo-vscode/src/AgentManagerProvider.ts)

Then make the UI compile, then wire message passing, then wire the backend.

## Non-goals

- Do not attempt a big extraction into shared packages.
- Do not implement every dialog/panel from the standalone app initially.
- Do not change the standalone `app/`.
