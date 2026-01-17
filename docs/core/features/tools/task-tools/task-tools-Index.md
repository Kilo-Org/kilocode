# Tools - Task Tools

**Quick Navigation for AI Agents**

---

## Overview

Task control tools. Enable AI to complete tasks, ask questions, create subtasks, and manage todo lists.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| AttemptCompletionTool | Mark task as complete | `AttemptCompletionTool.ts` | 8KB |
| AskFollowupQuestionTool | Ask user for clarification | `AskFollowupQuestionTool.ts` | 4KB |
| NewTaskTool | Create subtask | `NewTaskTool.ts` | - |
| UpdateTodoListTool | Update todo list | `UpdateTodoListTool.ts` | 7KB |

---

## AttemptCompletionTool

**Purpose**: Signal task completion to user

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| result | string | Yes | Completion message |
| command | string | No | Command to demonstrate |

**Behavior**:
1. Presents result to user
2. Optionally runs demo command
3. User confirms or continues

---

## AskFollowupQuestionTool

**Purpose**: Ask user for more information

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| question | string | Yes | Question to ask |

**Behavior**:
1. Displays question to user
2. Waits for response
3. Returns user's answer

---

## NewTaskTool

**Purpose**: Create a child/subtask

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task | string | Yes | Subtask description |
| mode | string | No | Mode for subtask |

---

## UpdateTodoListTool

**Purpose**: Manage task todo list

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| todos | array | Yes | Updated todo items |

**Todo Item**:
```typescript
{
  content: string;
  status: "pending" | "in_progress" | "completed";
}
```

---

[← Back to Tools](../tools-Index.md)
