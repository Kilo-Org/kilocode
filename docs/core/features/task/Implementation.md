# Task - Implementation

**Feature**: Task
**Source**: `src/core/task/Task.ts`
**Size**: 184KB (largest file in codebase)

---

## Overview

The Task class is the central orchestrator for Kilocode. It manages the entire lifecycle of an AI conversation including message handling, tool execution, checkpoints, and state persistence.

---

## Class Definition

```typescript
class Task extends EventEmitter<TaskEvents> implements TaskLike {
  readonly taskId: string;
  readonly instanceId: string;
  readonly metadata: TaskMetadata;
  // ... 50+ properties
}
```

---

## Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `taskId` | string | Unique task identifier |
| `instanceId` | string | Instance identifier |
| `apiConversationHistory` | ApiMessage[] | LLM conversation history |
| `clineMessages` | ClineMessage[] | UI chat messages |
| `api` | ApiHandler | API provider handler |
| `browserSession` | BrowserSession | Browser automation |
| `diffViewProvider` | DiffViewProvider | Diff view integration |
| `checkpointService` | RepoPerTaskCheckpointService | Checkpoint management |
| `abort` | boolean | Abort flag |
| `isStreaming` | boolean | Currently streaming response |

---

## Lifecycle Methods

### constructor()

Initializes task with options, sets up services.

```typescript
constructor(options: TaskOptions)
```

**Flow**:
1. Generate taskId and instanceId
2. Initialize API handler
3. Setup controllers (ignore, protected)
4. Initialize checkpoint service (if enabled)
5. Load history (if resuming)

---

### startTask()

Starts a new task with user message.

```typescript
private async startTask(task?: string, images?: string[]): Promise<void>
```

**Flow**:
1. Process @mentions in message
2. Build user content
3. Initialize task loop
4. Save to history

---

### resumeTaskFromHistory()

Resumes task from saved history.

```typescript
private async resumeTaskFromHistory(): Promise<void>
```

**Flow**:
1. Load saved messages
2. Restore state
3. Continue from last point

---

### abortTask()

Aborts current task execution.

```typescript
public async abortTask(isAbandoned = false): Promise<void>
```

---

## Core Execution Methods

### recursivelyMakeClineRequests()

Main execution loop - makes API requests and processes responses.

```typescript
public async recursivelyMakeClineRequests(
  userContent: ContentBlockParam[]
): Promise<void>
```

**Flow**:
1. Build system prompt
2. Make API request
3. Stream response
4. Parse tool calls
5. Execute tools
6. Recurse if needed

**Location**: `Task.ts:2478`

---

### initiateTaskLoop()

Initiates the main task execution loop.

```typescript
private async initiateTaskLoop(
  userContent: ContentBlockParam[]
): Promise<void>
```

**Location**: `Task.ts:2443`

---

## Message Methods

### say()

Sends a message to the UI.

```typescript
async say(
  type: ClineSay,
  text?: string,
  images?: string[],
  options?: { ...}
): Promise<void>
```

**Location**: `Task.ts:1683`

---

### ask()

Asks user for input/approval.

```typescript
async ask(
  type: ClineAsk,
  text?: string,
  options?: { ... }
): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>
```

**Location**: `Task.ts:1175`

---

### submitUserMessage()

Submits user message to conversation.

```typescript
public async submitUserMessage(
  text: string,
  images?: string[]
): Promise<void>
```

**Location**: `Task.ts:1542`

---

## Tool Execution

### Tool Flow

```
API Response → Parse Tools → Ask Approval → Execute → Return Result
```

Tool execution happens within `recursivelyMakeClineRequests()`:
1. Parse assistant message for tool calls
2. Validate tool parameters
3. Request user approval (if needed)
4. Execute tool via tool class
5. Add result to conversation
6. Continue loop

---

## Checkpoint Methods

### checkpointSave()

Saves current task state.

```typescript
public async checkpointSave(
  force: boolean = false,
  suppressMessage: boolean = false
): Promise<void>
```

**Location**: `Task.ts:4545`

---

### checkpointRestore()

Restores task to checkpoint state.

```typescript
public async checkpointRestore(
  options: CheckpointRestoreOptions
): Promise<void>
```

**Location**: `Task.ts:4690`

---

## Context Methods

### loadContext()

Loads context for system prompt.

```typescript
async loadContext(
  // parameters
): Promise<string>
```

**Location**: `Task.ts:3750`

---

### getSystemPrompt()

Builds system prompt for API request.

```typescript
async getSystemPrompt(): Promise<string>
```

**Location**: `Task.ts:3827`

---

### condenseContext()

Condenses conversation context when too large.

```typescript
public async condenseContext(): Promise<void>
```

**Location**: `Task.ts:1593`

---

## State Management

### History Persistence

- `saveApiConversationHistory()` - Save API messages
- `saveClineMessages()` - Save UI messages
- `getSavedApiConversationHistory()` - Load API messages
- `getSavedClineMessages()` - Load UI messages

### Token Tracking

- `getTokenUsage()` - Get current token usage
- `emitFinalTokenUsageUpdate()` - Emit final usage

---

## Subtask Methods

### startSubtask()

Creates a child task.

```typescript
public async startSubtask(
  message: string,
  initialTodos: TodoItem[],
  mode: string
): Promise<void>
```

**Location**: `Task.ts:2351`

---

### resumeAfterDelegation()

Resumes parent after subtask completes.

```typescript
public async resumeAfterDelegation(): Promise<void>
```

**Location**: `Task.ts:2377`

---

## Error Handling

### handleContextWindowExceededError()

Handles context window overflow.

```typescript
private async handleContextWindowExceededError(): Promise<void>
```

**Location**: `Task.ts:3941`

---

### backoffAndAnnounce()

Handles rate limits with exponential backoff.

```typescript
private async backoffAndAnnounce(
  retryAttempt: number,
  error: any
): Promise<void>
```

**Location**: `Task.ts:4476`

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `ApiHandler` | API communication |
| `ClineProvider` | Webview integration |
| `BrowserSession` | Browser automation |
| `DiffViewProvider` | Diff display |
| `McpHub` | MCP server access |
| `TerminalRegistry` | Terminal access |
| `FileContextTracker` | Context tracking |

---

[← Back to Task Index](./task-Index.md)
