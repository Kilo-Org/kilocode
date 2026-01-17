# Task - Type Definitions

**Feature**: Task
**Source**: `src/core/task/Task.ts`, `@roo-code/types`

---

## Interfaces

### TaskOptions

Options for creating a new Task instance.

```typescript
interface TaskOptions extends CreateTaskOptions {
  context: vscode.ExtensionContext;
  provider: ClineProvider;
  apiConfiguration: ProviderSettings;
  enableDiff?: boolean;
  enableCheckpoints?: boolean;
  checkpointTimeout?: number;
  enableBridge?: boolean;
  fuzzyMatchThreshold?: number;
  consecutiveMistakeLimit?: number;
  task?: string;
  images?: string[];
  historyItem?: HistoryItem;
  experiments?: Record<string, boolean>;
  startTask?: boolean;
  rootTask?: Task;
  parentTask?: Task;
  taskNumber?: number;
  onCreated?: (task: Task) => void;
  initialTodos?: TodoItem[];
  workspacePath?: string;
  initialStatus?: "active" | "delegated" | "completed";
}
```

**Key Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| context | ExtensionContext | Yes | VS Code extension context |
| provider | ClineProvider | Yes | Webview provider reference |
| apiConfiguration | ProviderSettings | Yes | API provider settings |
| task | string | No | Initial task description |
| historyItem | HistoryItem | No | Resume from history |
| enableCheckpoints | boolean | No | Enable task checkpoints |
| rootTask | Task | No | Parent task for subtasks |

---

### TaskLike (from @roo-code/types)

Interface that Task class implements.

```typescript
interface TaskLike {
  taskId: string;
  instanceId: string;
  metadata: TaskMetadata;
  // ... event methods
}
```

---

### TaskMetadata

Metadata about a task.

```typescript
interface TaskMetadata {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  totalTokens: number;
  totalCost: number;
}
```

---

### ClineMessage

Message in the conversation.

```typescript
interface ClineMessage {
  ts: number;           // Timestamp
  type: "say" | "ask";  // Message type
  say?: ClineSay;       // Say content
  ask?: ClineAsk;       // Ask content
  text?: string;        // Message text
  images?: string[];    // Attached images
}
```

---

### ApiMessage

Message in API conversation history.

```typescript
interface ApiMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
  reasoning?: string;
}
```

---

## Enums

### TaskStatus (from @roo-code/types)

```typescript
enum TaskStatus {
  IDLE = "idle",
  RUNNING = "running",
  PAUSED = "paused",
  COMPLETED = "completed",
  FAILED = "failed"
}
```

**State Transitions**:
```
IDLE → RUNNING → COMPLETED
         ↓          ↑
       PAUSED ──────┘
         ↓
       FAILED
```

---

### ClineAskResponse

User response to an ask.

```typescript
type ClineAskResponse =
  | "yesButtonClicked"
  | "noButtonClicked"
  | "messageResponse";
```

---

## Error Classes

### AskIgnoredError

Thrown when user ignores an ask.

```typescript
class AskIgnoredError extends Error {
  constructor(message?: string);
}
```

**Source**: `src/core/task/AskIgnoredError.ts`

---

### ToolResultIdMismatchError

Thrown when tool result IDs don't match.

```typescript
class ToolResultIdMismatchError extends Error {
  constructor(expectedIds: string[], actualIds: string[]);
}
```

**Source**: `src/core/task/validateToolResultIds.ts`

---

### MissingToolResultError

Thrown when tool results are missing.

```typescript
class MissingToolResultError extends Error {
  constructor(missingIds: string[]);
}
```

**Source**: `src/core/task/validateToolResultIds.ts`

---

## Constants

```typescript
const MAX_EXPONENTIAL_BACKOFF_SECONDS = 600;        // 10 minutes
const DEFAULT_USAGE_COLLECTION_TIMEOUT_MS = 5000;   // 5 seconds
const FORCED_CONTEXT_REDUCTION_PERCENT = 75;        // Keep 75% on context error
const MAX_CONTEXT_WINDOW_RETRIES = 3;               // Max retries for context errors
```

---

[← Back to Task Index](./task-Index.md)
