# Lessons Learned from JetBrains Plugin for VSCode Implementation

This document synthesizes the patterns and implementation details from the JetBrains Kilo plugin analysis, translating them into actionable recommendations for the VSCode implementation.

---

## Executive Summary

The JetBrains plugin demonstrates a mature, production-ready architecture for integrating with the Kilo CLI backend. Key takeaways:

1. **Three-Layer Architecture**: SSE Events → State Manager → UI Renderer provides clean separation and enables streaming optimization
2. **Fine-Grained State Updates**: Use event streams for incremental updates, not full re-renders
3. **Component Caching**: Cache rendered components (especially markdown) for streaming text append optimization
4. **Robust Error Handling**: Auto-reconnect with exponential backoff, health checks, graceful degradation
5. **Platform Abstraction**: Strategy pattern for cross-platform CLI discovery

The VSCode implementation should adopt these patterns while leveraging VSCode-specific APIs and the Solid.js webview architecture.

---

## Architecture Recommendations

### Three-Layer Design

The JetBrains plugin uses a clean three-layer architecture that should be replicated:

```
┌─────────────────────────────────────────────────────────────┐
│                    VSCode Extension                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Event Source                                       │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ SSEClient                                                ││
│  │ - Connects to /event endpoint                            ││
│  │ - Parses raw SSE into typed ServerEvent objects          ││
│  │ - Handles reconnection with exponential backoff          ││
│  └─────────────────────────────────────────────────────────┘│
│                           ↓                                  │
│  Layer 2: State Manager                                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ ChatStateManager          │  AppStateManager             ││
│  │ - Sessions list           │  - Providers/models          ││
│  │ - Messages per session    │  - Agents list               ││
│  │ - Parts per message       │  - Selected model/agent      ││
│  │ - Permissions/questions   │  - Attached files            ││
│  │ - Todos per session       │  - VCS info                  ││
│  │                           │                              ││
│  │ Emits: MessageChange      │  Emits: ConfigChange         ││
│  └─────────────────────────────────────────────────────────┘│
│                           ↓                                  │
│  Layer 3: UI Renderer (Webview)                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Solid.js Components                                      ││
│  │ - Consumes state via postMessage                         ││
│  │ - Caches rendered components                             ││
│  │ - Handles streaming text append optimization             ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Service Separation

**Recommendation**: Separate session-related state from app configuration state.

| Service | Responsibility | VSCode Equivalent |
|---------|---------------|-------------------|
| `ChatUiStateManager` | Sessions, messages, parts, permissions, questions, todos | `ChatStateManager` class |
| `KiloAppState` | Providers, agents, models, attached files, VCS info | `AppStateManager` class |
| `KiloProjectService` | Coordinates initialization, holds references | Extension activation context |
| `KiloServerService` | CLI process lifecycle | `ServerManager` (already exists) |

### TypeScript Implementation Pattern

```typescript
// src/services/state/chat-state-manager.ts
import { EventEmitter } from "events"
import type { SSEEvent, SessionInfo, MessageInfo, MessagePart } from "../cli-backend/types"

export interface MessageWithParts {
  message: MessageInfo
  parts: MessagePart[]
}

export type MessageChange =
  | { type: "initial-load"; sessionId: string; messages: MessageWithParts[] }
  | { type: "message-added"; sessionId: string; message: MessageWithParts }
  | { type: "message-removed"; sessionId: string; messageId: string }
  | { type: "part-added"; sessionId: string; messageId: string; part: MessagePart }
  | { type: "part-updated"; sessionId: string; messageId: string; part: MessagePart; delta?: string }
  | { type: "part-removed"; sessionId: string; messageId: string; partId: string }

export class ChatStateManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map()
  private messages: Map<string, MessageInfo[]> = new Map()
  private parts: Map<string, MessagePart[]> = new Map()
  
  // Emit fine-grained changes for UI optimization
  emitMessageChange(change: MessageChange): void {
    this.emit("message-change", change)
  }
  
  // Process SSE events and update internal state
  handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case "message.part.updated":
        // Pass delta through for streaming optimization
        this.emitMessageChange({
          type: "part-updated",
          sessionId: event.properties.part.sessionID,
          messageId: event.properties.part.messageID,
          part: event.properties.part,
          delta: event.properties.delta
        })
        break
      // ... other cases
    }
  }
}
```

---

## Communication Layer Design

### HTTP Client Patterns

The JetBrains plugin uses these HTTP patterns that should be replicated:

1. **Directory Header**: Always include `x-opencode-directory` header
2. **Timeout Configuration**: 10s connect timeout, 60s request timeout
3. **Async Message Sending**: Use `/session/{id}/prompt_async` for non-blocking sends

```typescript
// src/services/cli-backend/http-client.ts enhancements
export class HttpClient {
  private readonly defaultHeaders: Record<string, string>
  
  constructor(
    private readonly config: ServerConfig,
    private readonly directory: string
  ) {
    this.defaultHeaders = {
      "Content-Type": "application/json",
      "x-opencode-directory": directory,
      "Authorization": `Basic ${Buffer.from(`opencode:${config.password}`).toString("base64")}`
    }
  }
  
  // Key endpoints to implement
  async listSessions(): Promise<SessionInfo[]>
  async createSession(): Promise<SessionInfo>
  async getSession(id: string): Promise<SessionInfo>
  async deleteSession(id: string): Promise<void>
  async getMessages(sessionId: string): Promise<MessageInfo[]>
  async sendMessageAsync(sessionId: string, content: PromptContent): Promise<void>
  async abortSession(sessionId: string): Promise<void>
  async listPermissions(): Promise<PermissionRequest[]>
  async replyPermission(id: string, reply: "once" | "always" | "reject"): Promise<void>
  async listQuestions(): Promise<QuestionRequest[]>
  async replyQuestion(id: string, answers: string[][]): Promise<void>
  async getProviders(): Promise<ProviderListResponse>
  async healthCheck(): Promise<HealthResponse>
}
```

### SSE Auto-Reconnect with Exponential Backoff

**Current Gap**: The existing [`SSEClient`](src/services/cli-backend/sse-client.ts) lacks auto-reconnect.

**Recommendation**: Add exponential backoff reconnection:

```typescript
// Enhanced SSE client with auto-reconnect
export class SSEClient {
  private reconnectDelay = 2000
  private readonly maxReconnectDelay = 30000
  private shouldReconnect = true
  private reconnectTimeout: NodeJS.Timeout | null = null
  
  connect(directory: string): void {
    this.shouldReconnect = true
    this.doConnect(directory)
  }
  
  private doConnect(directory: string): void {
    // ... existing connection logic ...
    
    this.eventSource.onerror = () => {
      this.notifyState("disconnected")
      
      if (this.shouldReconnect) {
        this.notifyState("reconnecting")
        this.reconnectTimeout = setTimeout(() => {
          this.doConnect(directory)
        }, this.reconnectDelay)
        
        // Exponential backoff
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay
        )
      }
    }
    
    this.eventSource.onopen = () => {
      this.reconnectDelay = 2000 // Reset on success
      this.notifyState("connected")
    }
  }
  
  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }
    // ... existing disconnect logic ...
  }
}
```

### Connection State Type

Extend the connection state to include reconnecting:

```typescript
export type ConnectionState = 
  | "disconnected" 
  | "connecting" 
  | "connected" 
  | "reconnecting" 
  | "error"
```

---

## State Management Strategy

### Reactive State with Signals (Solid.js)

The JetBrains plugin uses Kotlin StateFlow/SharedFlow. In VSCode with Solid.js, use signals:

```typescript
// webview-ui/src/stores/chat-store.ts
import { createSignal, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"

interface ChatState {
  sessions: SessionInfo[]
  currentSessionId: string | null
  sessionStatuses: Record<string, SessionStatusInfo>
  messages: Record<string, MessageWithParts[]>
  pendingPermissions: PermissionRequest[]
  pendingQuestions: QuestionRequest[]
  todos: Record<string, TodoItem[]>
  isLoading: boolean
  error: string | null
}

export function createChatStore() {
  const [state, setState] = createStore<ChatState>({
    sessions: [],
    currentSessionId: null,
    sessionStatuses: {},
    messages: {},
    pendingPermissions: [],
    pendingQuestions: [],
    todos: {},
    isLoading: false,
    error: null
  })
  
  // Derived state
  const currentSession = createMemo(() => 
    state.sessions.find(s => s.id === state.currentSessionId)
  )
  
  const currentMessages = createMemo(() =>
    state.currentSessionId ? state.messages[state.currentSessionId] ?? [] : []
  )
  
  // Actions
  function handleMessageChange(change: MessageChange) {
    setState(produce(draft => {
      switch (change.type) {
        case "part-updated":
          // Find and update the specific part
          const messages = draft.messages[change.sessionId]
          if (messages) {
            const msg = messages.find(m => m.message.id === change.messageId)
            if (msg) {
              const partIndex = msg.parts.findIndex(p => p.id === change.part.id)
              if (partIndex >= 0) {
                msg.parts[partIndex] = change.part
              } else {
                msg.parts.push(change.part)
              }
            }
          }
          break
        // ... other cases
      }
    }))
  }
  
  return { state, currentSession, currentMessages, handleMessageChange }
}
```

### Extension ↔ Webview Communication

Use VSCode's postMessage API with typed messages:

```typescript
// src/types/webview-messages.ts
export type ExtensionToWebviewMessage =
  | { type: "state-update"; payload: Partial<ChatState> }
  | { type: "message-change"; payload: MessageChange }
  | { type: "connection-status"; payload: ConnectionState }
  | { type: "error"; payload: string }

export type WebviewToExtensionMessage =
  | { type: "send-message"; payload: { sessionId: string; content: string; files?: AttachedFile[] } }
  | { type: "abort"; payload: { sessionId: string } }
  | { type: "create-session"; payload: Record<string, never> }
  | { type: "select-session"; payload: { sessionId: string } }
  | { type: "delete-session"; payload: { sessionId: string } }
  | { type: "reply-permission"; payload: { id: string; reply: "once" | "always" | "reject" } }
  | { type: "reply-question"; payload: { id: string; answers: string[][] } }
  | { type: "attach-file"; payload: AttachedFile }
  | { type: "remove-file"; payload: { path: string } }
```

---

## UI/UX Implementation Guidelines

### Streaming Text Optimization

**Critical Pattern**: The JetBrains plugin optimizes streaming by appending text deltas directly without re-parsing markdown.

```typescript
// webview-ui/src/components/MarkdownRenderer.tsx
import { createSignal, createEffect, onCleanup } from "solid-js"
import { marked } from "marked"

interface Props {
  partId: string
  initialText: string
}

export function MarkdownRenderer(props: Props) {
  const [text, setText] = createSignal(props.initialText)
  const [html, setHtml] = createSignal("")
  
  // Track code block count for structure change detection
  let lastCodeBlockCount = 0
  
  // Listen for delta updates
  createEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg.type === "text-delta" && msg.partId === props.partId) {
        const newText = text() + msg.delta
        setText(newText)
        
        // Only re-parse if code block structure changed
        const newCodeBlockCount = (newText.match(/```/g) || []).length
        if (newCodeBlockCount !== lastCodeBlockCount) {
          setHtml(marked.parse(newText))
          lastCodeBlockCount = newCodeBlockCount
        } else {
          // Append to last text node (optimization)
          appendToLastTextNode(msg.delta)
        }
      }
    }
    
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })
  
  // Initial render
  createEffect(() => {
    setHtml(marked.parse(text()))
  })
  
  return <div class="markdown-content" innerHTML={html()} />
}
```

### Component Caching

Cache rendered message components to avoid re-creation during streaming:

```typescript
// webview-ui/src/components/MessageList.tsx
import { For, createMemo } from "solid-js"

export function MessageList(props: { messages: MessageWithParts[] }) {
  // Use keyed For to maintain component identity
  return (
    <div class="message-list">
      <For each={props.messages}>
        {(msg) => <MessageBlock key={msg.message.id} message={msg} />}
      </For>
    </div>
  )
}

// Individual message component maintains its own part cache
function MessageBlock(props: { message: MessageWithParts }) {
  // Parts are keyed by ID, so updates don't recreate components
  return (
    <div class="message-block">
      <For each={props.message.parts}>
        {(part) => <PartRenderer key={part.id} part={part} />}
      </For>
    </div>
  )
}
```

### Tool Call Display

Implement collapsible tool panels with status indicators:

```typescript
// webview-ui/src/components/ToolCallPanel.tsx
import { createSignal, Show } from "solid-js"

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read: "Read File",
  write: "Write File",
  edit: "Edit File",
  bash: "Run Command",
  glob: "Find Files",
  grep: "Search Content",
  task: "Sub-task",
  webfetch: "Fetch URL",
  websearch: "Web Search",
  todowrite: "Update Todos",
  todoread: "Read Todos",
  question: "Ask Question"
}

interface Props {
  part: ToolPart
}

export function ToolCallPanel(props: Props) {
  const [expanded, setExpanded] = createSignal(
    props.part.state.status === "error" // Auto-expand on error
  )
  
  const displayName = () => 
    props.part.state.title || 
    TOOL_DISPLAY_NAMES[props.part.tool] || 
    props.part.tool
  
  const statusIcon = () => {
    switch (props.part.state.status) {
      case "pending": return "⏳"
      case "running": return "🔄"
      case "completed": return "✅"
      case "error": return "❌"
    }
  }
  
  return (
    <div class="tool-panel">
      <button 
        class="tool-header" 
        onClick={() => setExpanded(!expanded())}
      >
        <span class="status-icon">{statusIcon()}</span>
        <span class="tool-name">{displayName()}</span>
        <span class="expand-icon">{expanded() ? "▼" : "▶"}</span>
      </button>
      
      <Show when={expanded()}>
        <div class="tool-content">
          <Show when={props.part.state.status === "completed"}>
            <pre class="tool-output">{props.part.state.output}</pre>
          </Show>
          <Show when={props.part.state.status === "error"}>
            <pre class="tool-error">{props.part.state.error}</pre>
          </Show>
        </div>
      </Show>
    </div>
  )
}
```

### Loading and Error States

Show appropriate states during initialization:

```typescript
// webview-ui/src/App.tsx
import { Match, Switch } from "solid-js"

export function App() {
  const { connectionState, error, isInitialized } = useChatStore()
  
  return (
    <Switch fallback={<ChatInterface />}>
      <Match when={connectionState() === "connecting"}>
        <LoadingPanel message="Connecting to Kilo..." />
      </Match>
      <Match when={connectionState() === "reconnecting"}>
        <LoadingPanel message="Reconnecting..." showSpinner />
      </Match>
      <Match when={error()}>
        <ErrorPanel 
          message={error()} 
          onRetry={() => reconnect()} 
        />
      </Match>
      <Match when={!isInitialized()}>
        <LoadingPanel message="Initializing..." />
      </Match>
    </Switch>
  )
}
```

---

## Error Handling Best Practices

### Result Type Pattern

Use a Result type for operations that can fail:

```typescript
// src/utils/result.ts
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

// Usage
async function initialize(): Promise<Result<Services>> {
  const serverResult = await serverManager.start()
  if (!serverResult.ok) {
    return err(serverResult.error)
  }
  
  const healthResult = await waitForHealth(serverResult.value.port)
  if (!healthResult.ok) {
    await serverManager.stop()
    return err(healthResult.error)
  }
  
  return ok({ server: serverResult.value, /* ... */ })
}
```

### Health Check with Retry

```typescript
// src/services/cli-backend/server-manager.ts
async function waitForHealth(
  port: number, 
  maxRetries = 30, 
  delayMs = 200
): Promise<Result<void>> {
  for (let i = 0; i < maxRetries; i++) {
    const health = await checkHealth(port)
    if (health.ok && health.value.healthy) {
      return ok(undefined)
    }
    
    // Check if process died
    if (!isProcessAlive()) {
      return err(new Error("Server process died unexpectedly"))
    }
    
    await delay(delayMs)
  }
  
  return err(new Error("Health check timeout"))
}
```

### Graceful Degradation

```typescript
// Don't let logging failures break the extension
function log(level: string, message: string, error?: Error): void {
  try {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] [Kilo New] [${level}] ${message}`
    
    console.log(logMessage)
    if (error) {
      console.error(error)
    }
    
    // Write to output channel
    outputChannel?.appendLine(logMessage)
  } catch {
    // Silently ignore logging failures
  }
}
```

### User-Facing Error Notifications

```typescript
// src/utils/notifications.ts
import * as vscode from "vscode"

export function notifyError(message: string, actions?: string[]): void {
  if (actions?.length) {
    vscode.window.showErrorMessage(message, ...actions).then(selected => {
      // Handle action selection
    })
  } else {
    vscode.window.showErrorMessage(message)
  }
}

export function notifyWarning(message: string): void {
  vscode.window.showWarningMessage(message)
}

export function notifyInfo(message: string): void {
  vscode.window.showInformationMessage(message)
}
```

---

## Platform Considerations

### CLI Discovery Strategy

The JetBrains plugin uses a strategy pattern for cross-platform CLI discovery. Implement similarly:

```typescript
// src/services/cli-backend/cli-discovery.ts
import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import { execSync } from "child_process"

const BINARY_NAMES = ["kilo", "opencode"]

interface DiscoveryStrategy {
  findBinary(name: string): string | null
}

class MacOsDiscovery implements DiscoveryStrategy {
  private readonly knownPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".bun/bin"),
    path.join(os.homedir(), ".local/bin"),
    "/opt/local/bin"
  ]
  
  findBinary(name: string): string | null {
    // Check known paths first
    for (const dir of this.knownPaths) {
      const fullPath = path.join(dir, name)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }
    
    // Fall back to which
    try {
      const result = execSync(`which ${name}`, { encoding: "utf8" })
      return result.trim() || null
    } catch {
      return null
    }
  }
}

class WindowsDiscovery implements DiscoveryStrategy {
  private readonly knownPaths = [
    path.join(os.homedir(), "AppData/Roaming/npm"),
    path.join(os.homedir(), ".bun/bin"),
    "C:/Program Files/nodejs"
  ]
  
  findBinary(name: string): string | null {
    const exeNames = [`${name}.exe`, `${name}.cmd`, name]
    
    for (const dir of this.knownPaths) {
      for (const exe of exeNames) {
        const fullPath = path.join(dir, exe)
        if (fs.existsSync(fullPath)) {
          return fullPath
        }
      }
    }
    
    // Fall back to where
    try {
      const result = execSync(`where ${name}`, { encoding: "utf8" })
      const lines = result.trim().split("\n")
      return lines[0] || null
    } catch {
      return null
    }
  }
}

class LinuxDiscovery implements DiscoveryStrategy {
  private readonly knownPaths = [
    "/usr/local/bin",
    path.join(os.homedir(), ".local/bin"),
    path.join(os.homedir(), ".bun/bin"),
    "/usr/bin"
  ]
  
  findBinary(name: string): string | null {
    for (const dir of this.knownPaths) {
      const fullPath = path.join(dir, name)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }
    
    try {
      const result = execSync(`which ${name}`, { encoding: "utf8" })
      return result.trim() || null
    } catch {
      return null
    }
  }
}

export function findKiloBinary(): string | null {
  const strategy = getStrategy()
  
  for (const name of BINARY_NAMES) {
    const result = strategy.findBinary(name)
    if (result) {
      return result
    }
  }
  
  return null
}

function getStrategy(): DiscoveryStrategy {
  switch (os.platform()) {
    case "darwin": return new MacOsDiscovery()
    case "win32": return new WindowsDiscovery()
    default: return new LinuxDiscovery()
  }
}
```

### Process Management

```typescript
// src/services/cli-backend/server-manager.ts
import { spawn, ChildProcess } from "child_process"

export class ServerManager {
  private process: ChildProcess | null = null
  
  async start(port: number, workingDir: string): Promise<Result<void>> {
    const binary = findKiloBinary()
    if (!binary) {
      return err(new Error("Kilo CLI not found"))
    }
    
    const args = ["serve", "--port", port.toString()]
    
    this.process = spawn(binary, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        OPENCODE_CALLER: "vscode"
      },
      stdio: ["ignore", "pipe", "pipe"]
    })
    
    // Log stdout/stderr
    this.process.stdout?.on("data", (data) => {
      log("debug", `Server: ${data}`)
    })
    
    this.process.stderr?.on("data", (data) => {
      log("warn", `Server stderr: ${data}`)
    })
    
    this.process.on("exit", (code) => {
      log("info", `Server exited with code ${code}`)
      this.process = null
    })
    
    return ok(undefined)
  }
  
  async stop(): Promise<void> {
    if (!this.process) return
    
    // Try graceful shutdown first
    this.process.kill("SIGTERM")
    
    // Wait up to 500ms for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL")
        }
        resolve()
      }, 500)
      
      this.process?.on("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    
    this.process = null
  }
  
  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }
}
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Enhance `SSEClient` with auto-reconnect and exponential backoff
- [ ] Add `reconnecting` state to connection status
- [ ] Implement `ChatStateManager` for session/message state
- [ ] Implement `AppStateManager` for config state
- [ ] Add `MessageChange` event types for fine-grained updates
- [ ] Implement cross-platform CLI discovery

### Phase 2: HTTP API
- [ ] Complete `HttpClient` with all endpoints
- [ ] Add `x-opencode-directory` header to all requests
- [ ] Implement health check polling
- [ ] Add proper timeout configuration

### Phase 3: Extension ↔ Webview Communication
- [ ] Define typed message protocol
- [ ] Implement message handlers in extension
- [ ] Implement message handlers in webview
- [ ] Add state synchronization on webview load

### Phase 4: Webview UI (Solid.js)
- [ ] Create chat store with signals
- [ ] Implement `MessageList` with component caching
- [ ] Implement `MarkdownRenderer` with streaming optimization
- [ ] Implement `ToolCallPanel` with collapsible display
- [ ] Add loading/error/reconnecting states
- [ ] Implement file autocomplete on `@` character

### Phase 5: Error Handling
- [ ] Implement Result type pattern
- [ ] Add graceful degradation for logging
- [ ] Implement user-facing notifications
- [ ] Add dedicated output channel for debugging

### Phase 6: Polish
- [ ] Add keyboard shortcuts (Ctrl+Escape to open, Ctrl+Shift+K for new session)
- [ ] Implement drag & drop file attachment
- [ ] Add context menu action for "Add File to Context"
- [ ] Test on Windows, macOS, and Linux

---

## Key Gotchas to Avoid

1. **Don't re-render entire message list on streaming updates** - Use fine-grained updates with component caching

2. **Don't re-parse markdown on every text delta** - Only re-parse when code block structure changes

3. **Don't forget the directory header** - All API requests need `x-opencode-directory`

4. **Don't block on message sending** - Use async endpoint and handle response via SSE

5. **Don't ignore SSE reconnection** - Network issues are common; auto-reconnect is essential

6. **Don't mix session state with app config** - Keep them in separate managers for clarity

7. **Don't forget to dispose resources** - Clean up SSE connections, event listeners, and processes

8. **Don't assume CLI location** - Use platform-specific discovery with multiple fallback paths

9. **Don't let logging failures crash the extension** - Wrap logging in try/catch

10. **Don't forget to track permission/question → message mapping** - Needed for UI display context

---

## Appendix: Event Type Reference

### Events to Handle

| Event Type | Action |
|------------|--------|
| `server.connected` | Update connection status |
| `server.heartbeat` | Ignore (keep-alive) |
| `session.created` | Add to sessions list |
| `session.updated` | Update session in list |
| `session.deleted` | Remove from sessions list |
| `session.status` | Update session status map |
| `session.idle` | Clear busy status |
| `message.updated` | Add/update message |
| `message.removed` | Remove message |
| `message.part.updated` | Add/update part (with delta for streaming) |
| `message.part.removed` | Remove part |
| `permission.asked` | Add to pending permissions |
| `permission.replied` | Remove from pending permissions |
| `question.asked` | Add to pending questions |
| `question.replied` | Remove from pending questions |
| `todo.updated` | Update todos for session |
| `vcs.branch.updated` | Update VCS info |

### Events to Ignore

- `server.instance.disposed`
- `global.disposed`
- `session.error`
- `session.compacted`
- `file.edited`
- `file.updated`
- `project.updated`
