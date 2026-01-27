# CLI Agent Loop

This document explains how the Roo Code CLI detects and tracks the agent loop state.

## Overview

The CLI needs to know when the agent is:

- **Running** (actively processing)
- **Streaming** (receiving content from the API)
- **Waiting for input** (needs user approval or answer)
- **Idle** (task completed or failed)

This is accomplished by analyzing the messages the extension sends to the client.

## The Message Model

All agent activity is communicated through **ClineMessages** - a stream of timestamped messages that represent everything the agent does.

### Message Structure

```typescript
interface ClineMessage {
	ts: number // Unique timestamp identifier
	type: "ask" | "say" // Message category
	ask?: ClineAsk // Specific ask type (when type="ask")
	say?: ClineSay // Specific say type (when type="say")
	text?: string // Message content
	partial?: boolean // Is this message still streaming?
}
```

### Two Types of Messages

| Type    | Purpose                                        | Blocks Agent? |
| ------- | ---------------------------------------------- | ------------- |
| **say** | Informational - agent is telling you something | No            |
| **ask** | Interactive - agent needs something from you   | Usually yes   |

## The Key Insight

> **The agent loop stops whenever the last message is an `ask` type (with `partial: false`).**

The specific `ask` value tells you exactly what the agent needs.

## Ask Categories

The CLI categorizes asks into four groups:

### 1. Interactive Asks → `WAITING_FOR_INPUT` state

These require user action to continue:

| Ask Type                | What It Means                     | Required Response |
| ----------------------- | --------------------------------- | ----------------- |
| `tool`                  | Wants to edit/create/delete files | Approve or Reject |
| `command`               | Wants to run a terminal command   | Approve or Reject |
| `followup`              | Asking a question                 | Text answer       |
| `browser_action_launch` | Wants to use the browser          | Approve or Reject |
| `use_mcp_server`        | Wants to use an MCP server        | Approve or Reject |

### 2. Idle Asks → `IDLE` state

These indicate the task has stopped:

| Ask Type                        | What It Means               | Response Options            |
| ------------------------------- | --------------------------- | --------------------------- |
| `completion_result`             | Task completed successfully | New task or feedback        |
| `api_req_failed`                | API request failed          | Retry or new task           |
| `mistake_limit_reached`         | Too many errors             | Continue anyway or new task |
| `auto_approval_max_req_reached` | Auto-approval limit hit     | Continue manually or stop   |
| `resume_completed_task`         | Viewing completed task      | New task                    |

### 3. Resumable Asks → `RESUMABLE` state

| Ask Type      | What It Means             | Response Options  |
| ------------- | ------------------------- | ----------------- |
| `resume_task` | Task paused mid-execution | Resume or abandon |

### 4. Non-Blocking Asks → `RUNNING` state

| Ask Type         | What It Means      | Response Options  |
| ---------------- | ------------------ | ----------------- |
| `command_output` | Command is running | Continue or abort |

## Streaming Detection

The agent is **streaming** when:

1. **`partial: true`** on the last message, OR
2. **An `api_req_started` message exists** with `cost: undefined` in its text field

```typescript
// Streaming detection pseudocode
function isStreaming(messages) {
	const lastMessage = messages.at(-1)

	// Check partial flag (primary indicator)
	if (lastMessage?.partial === true) {
		return true
	}

	// Check for in-progress API request
	const apiReq = messages.findLast((m) => m.say === "api_req_started")
	if (apiReq?.text) {
		const data = JSON.parse(apiReq.text)
		if (data.cost === undefined) {
			return true // API request not yet complete
		}
	}

	return false
}
```

## State Machine

```
                    ┌─────────────────┐
                    │    NO_TASK      │  (no messages)
                    └────────┬────────┘
                             │ newTask
                             ▼
              ┌─────────────────────────────┐
         ┌───▶│         RUNNING             │◀───┐
         │    └──────────┬──────────────────┘    │
         │               │                       │
         │    ┌──────────┼──────────────┐        │
         │    │          │              │        │
         │    ▼          ▼              ▼        │
         │ ┌──────┐  ┌─────────┐  ┌──────────┐   │
         │ │STREAM│  │WAITING_ │  │   IDLE   │   │
         │ │ ING  │  │FOR_INPUT│  │          │   │
         │ └──┬───┘  └────┬────┘  └────┬─────┘   │
         │    │           │            │         │
         │    │ done      │ approved   │ newTask │
         └────┴───────────┴────────────┘         │
                                                 │
         ┌──────────────┐                        │
         │  RESUMABLE   │────────────────────────┘
         └──────────────┘  resumed
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ExtensionHost                            │
│                                                                 │
│  ┌──────────────────┐                                           │
│  │   Extension      │──── extensionWebviewMessage ─────┐        │
│  │   (Task.ts)      │                                  │        │
│  └──────────────────┘                                  │        │
│                                                        ▼        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    ExtensionClient                        │  │
│  │                (Single Source of Truth)                   │  │
│  │                                                           │  │
│  │  ┌─────────────────┐    ┌────────────────────┐            │  │
│  │  │ MessageProcessor │───▶│    StateStore     │            │  │
│  │  │                 │    │  (clineMessages)   │            │  │
│  │  └─────────────────┘    └────────┬───────────┘            │  │
│  │                                  │                        │  │
│  │                                  ▼                        │  │
│  │                         detectAgentState()                │  │
│  │                                  │                        │  │
│  │                                  ▼                        │  │
│  │  Events: stateChange, message, waitingForInput, etc.      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐     │
│  │ OutputManager  │  │  AskDispatcher │  │ PromptManager  │     │
│  │  (stdout)      │  │  (ask routing) │  │  (user input)  │     │
│  └────────────────┘  └────────────────┘  └────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### ExtensionClient

The **single source of truth** for agent state, including the current mode. It:

- Receives all messages from the extension
- Stores them in the `StateStore`
- Tracks the current mode from state messages
- Computes the current state via `detectAgentState()`
- Emits events when state changes (including mode changes)

```typescript
const client = new ExtensionClient({
	sendMessage: (msg) => extensionHost.sendToExtension(msg),
	debug: true, // Writes to ~/.roo/cli-debug.log
})

// Query state at any time
const state = client.getAgentState()
if (state.isWaitingForInput) {
	console.log(`Agent needs: ${state.currentAsk}`)
}

// Query current mode
const mode = client.getCurrentMode()
console.log(`Current mode: ${mode}`) // e.g., "code", "architect", "ask"

// Subscribe to events
client.on("waitingForInput", (event) => {
	console.log(`Waiting for: ${event.ask}`)
})

// Subscribe to mode changes
client.on("modeChanged", (event) => {
	console.log(`Mode changed: ${event.previousMode} -> ${event.currentMode}`)
})
```

### StateStore

Holds the `clineMessages` array, computed state, and current mode:

```typescript
interface StoreState {
	messages: ClineMessage[] // The raw message array
	agentState: AgentStateInfo // Computed state
	isInitialized: boolean // Have we received any state?
	currentMode: string | undefined // Current mode (e.g., "code", "architect")
}
```

### MessageProcessor

Handles incoming messages from the extension:

- `"state"` messages → Update `clineMessages` array and track mode
- `"messageUpdated"` messages → Update single message in array
- Emits events for state transitions and mode changes

### AskDispatcher

Routes asks to appropriate handlers:

- Uses type guards: `isIdleAsk()`, `isInteractiveAsk()`, etc.
- Coordinates between `OutputManager` and `PromptManager`
- In non-interactive mode (`-y` flag), auto-approves everything

### OutputManager

Handles all CLI output:

- Streams partial content with delta computation
- Tracks what's been displayed to avoid duplicates
- Writes directly to `process.stdout` (bypasses quiet mode)

### PromptManager

Handles user input:

- Yes/no prompts
- Text input prompts
- Timed prompts with auto-defaults

## Response Messages

When the agent is waiting, send these responses:

```typescript
// Approve an action (tool, command, browser, MCP)
client.sendMessage({
	type: "askResponse",
	askResponse: "yesButtonClicked",
})

// Reject an action
client.sendMessage({
	type: "askResponse",
	askResponse: "noButtonClicked",
})

// Answer a question
client.sendMessage({
	type: "askResponse",
	askResponse: "messageResponse",
	text: "My answer here",
})

// Start a new task
client.sendMessage({
	type: "newTask",
	text: "Build a web app",
})

// Cancel current task
client.sendMessage({
	type: "cancelTask",
})
```

## Type Guards

The CLI uses type guards from `@roo-code/types` for categorization:

```typescript
import { isIdleAsk, isInteractiveAsk, isResumableAsk, isNonBlockingAsk } from "@roo-code/types"

const ask = message.ask
if (isInteractiveAsk(ask)) {
	// Needs approval: tool, command, followup, etc.
} else if (isIdleAsk(ask)) {
	// Task stopped: completion_result, api_req_failed, etc.
} else if (isResumableAsk(ask)) {
	// Task paused: resume_task
} else if (isNonBlockingAsk(ask)) {
	// Command running: command_output
}
```

## Debug Logging

Enable with `-d` flag. Logs go to `~/.roo/cli-debug.log`:

```bash
roo -d -y -P "Build something" --no-tui
```

View logs:

```bash
tail -f ~/.roo/cli-debug.log
```

Example output:

```
[MessageProcessor] State update: {
  "messageCount": 5,
  "lastMessage": {
    "msgType": "ask:completion_result"
  },
  "stateTransition": "running → idle",
  "currentAsk": "completion_result",
  "isWaitingForInput": true
}
[MessageProcessor] EMIT waitingForInput: { "ask": "completion_result" }
[MessageProcessor] EMIT taskCompleted: { "success": true }
```

## Summary

1. **Agent communicates via `ClineMessage` stream**
2. **Last message determines state**
3. **`ask` messages (non-partial) block the agent**
4. **Ask category determines required action**
5. **`partial: true` or `api_req_started` without cost = streaming**
6. **`ExtensionClient` is the single source of truth**
