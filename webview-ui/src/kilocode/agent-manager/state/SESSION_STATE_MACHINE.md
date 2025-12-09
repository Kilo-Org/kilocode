# Agent Manager Session State Machine

## Overview

This document defines the state machine for Agent Manager sessions. The state machine manages the lifecycle of an agent session from creation to completion, handling all intermediate states like streaming, waiting for approval, and error conditions.

## States

### `idle`

- **Description**: No active session or session has been deselected
- **UI Behavior**: Show "New Agent" form
- **Spinner**: No

### `creating`

- **Description**: CLI process is starting, waiting for `session_created` event
- **UI Behavior**: Show loading state with "Creating session..." message
- **Spinner**: Yes (creating indicator)
- **Entry Condition**: User submits a prompt to start a new agent

### `streaming`

- **Description**: Agent is actively working (API request in progress, generating response)
- **UI Behavior**: Show messages as they stream in
- **Spinner**: Yes (running indicator)
- **Entry Condition**: `api_req_started` event received

### `waiting_approval`

- **Description**: Agent is waiting for user to approve a tool/command action
- **UI Behavior**: Show the tool/command request, highlight that approval is needed
- **Spinner**: No
- **Entry Condition**: Complete (non-partial) `ask:tool` or `ask:command` received
- **Note**: In auto-approve mode, this state is transient (immediately transitions back to streaming)

### `waiting_input`

- **Description**: Agent is waiting for user to respond to a question
- **UI Behavior**: Show the question, input field focused
- **Spinner**: No
- **Entry Condition**: Complete (non-partial) `ask:followup` received

### `completed`

- **Description**: Agent has finished the task successfully
- **UI Behavior**: Show completion message, allow user to start new task or continue
- **Spinner**: No
- **Entry Condition**: `ask:completion_result` received

### `paused`

- **Description**: Session was interrupted and can be resumed
- **UI Behavior**: Show "Resume" option
- **Spinner**: No
- **Entry Condition**: `ask:resume_task` or `ask:resume_completed_task` received

### `error`

- **Description**: An error occurred (API failure, rate limit, invalid model, etc.)
- **UI Behavior**: Show error message with retry/cancel options
- **Spinner**: No
- **Entry Condition**: `ask:api_req_failed`, `ask:mistake_limit_reached`, `ask:invalid_model`, or CLI process error

### `stopped`

- **Description**: Session was manually stopped by user
- **UI Behavior**: Show stopped state, allow resume
- **Spinner**: No
- **Entry Condition**: User clicks cancel/stop button

## Events

### From CLI Process

| Event                         | Source            | Description                          |
| ----------------------------- | ----------------- | ------------------------------------ |
| `session_created`             | CLI               | Session ID assigned, CLI ready       |
| `api_req_started`             | Extension message | API request initiated                |
| `say:text`                    | Extension message | Agent text response (can be partial) |
| `say:completion_result`       | Extension message | Task completed successfully          |
| `say:checkpoint_saved`        | Extension message | Checkpoint created (internal, no UI) |
| `ask:tool`                    | Extension message | Agent wants to use a tool            |
| `ask:command`                 | Extension message | Agent wants to run a command         |
| `ask:followup`                | Extension message | Agent has a question                 |
| `ask:completion_result`       | Extension message | Task completed, awaiting feedback    |
| `ask:api_req_failed`          | Extension message | API request failed                   |
| `ask:resume_task`             | Extension message | Task can be resumed                  |
| `ask:resume_completed_task`   | Extension message | Completed task can be continued      |
| `ask:mistake_limit_reached`   | Extension message | Too many errors                      |
| `ask:payment_required_prompt` | Extension message | Credits/billing needed               |
| `ask:invalid_model`           | Extension message | Model configuration invalid          |
| `ask:browser_action_launch`   | Extension message | Browser action approval needed       |
| `ask:use_mcp_server`          | Extension message | MCP server usage approval needed     |
| `process_exit`                | CLI               | CLI process terminated               |
| `process_error`               | CLI               | CLI process error                    |

### From User

| Event            | Source | Description                              |
| ---------------- | ------ | ---------------------------------------- |
| `start_session`  | UI     | User submits prompt to start new session |
| `send_message`   | UI     | User sends a message/response            |
| `approve_action` | UI     | User approves tool/command (future)      |
| `reject_action`  | UI     | User rejects tool/command (future)       |
| `cancel_session` | UI     | User clicks cancel/stop                  |
| `resume_session` | UI     | User clicks resume                       |

## State Transitions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────┐  start_session   ┌──────────┐  session_created   ┌───────────┐   │
│  │ idle │ ───────────────► │ creating │ ─────────────────► │ streaming │   │
│  └──────┘                  └──────────┘                    └───────────┘   │
│      ▲                          │                               │  ▲       │
│      │                          │ process_error                 │  │       │
│      │                          ▼                               │  │       │
│      │                     ┌─────────┐                          │  │       │
│      │ cancel_session      │  error  │ ◄────────────────────────┘  │       │
│      │                     └─────────┘  ask:api_req_failed         │       │
│      │                          │       ask:mistake_limit_reached  │       │
│      │                          │       ask:invalid_model          │       │
│      │                          │       ask:payment_required       │       │
│      │                          │                                  │       │
│      │                          │ retry/resume                     │       │
│      │                          └──────────────────────────────────┘       │
│      │                                                                     │
│      │                                                                     │
│      │  ┌───────────┐  ask:tool/command (complete)  ┌──────────────────┐   │
│      │  │ streaming │ ────────────────────────────► │ waiting_approval │   │
│      │  └───────────┘                               └──────────────────┘   │
│      │       │  ▲                                          │               │
│      │       │  │ approve_action / auto-approve            │               │
│      │       │  └──────────────────────────────────────────┘               │
│      │       │                                                             │
│      │       │  ask:followup (complete)             ┌────────────────┐     │
│      │       └────────────────────────────────────► │ waiting_input  │     │
│      │       ▲                                      └────────────────┘     │
│      │       │ send_message                                │               │
│      │       └─────────────────────────────────────────────┘               │
│      │                                                                     │
│      │       │  ask:completion_result               ┌───────────┐          │
│      │       └────────────────────────────────────► │ completed │          │
│      │                                              └───────────┘          │
│      │                                                   │                 │
│      │ cancel_session                                    │ send_message    │
│      │                                                   │ (continue)      │
│      │  ┌─────────┐                                      │                 │
│      └──│ stopped │ ◄────────────────────────────────────┘                 │
│         └─────────┘                                                        │
│              │                                                             │
│              │ resume_session                                              │
│              └───────────────────────────────────► streaming               │
│                                                                            │
│         ┌────────┐  ask:resume_task                                        │
│         │ paused │ ◄─────────────────────────────── streaming              │
│         └────────┘                                                         │
│              │                                                             │
│              │ resume_session                                              │
│              └───────────────────────────────────► streaming               │
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Transition Table

| Current State      | Event                       | Next State         | Condition                          |
| ------------------ | --------------------------- | ------------------ | ---------------------------------- |
| `idle`             | `start_session`             | `creating`         | -                                  |
| `creating`         | `session_created`           | `streaming`        | `api_req_started` already received |
| `creating`         | `session_created`           | `creating`         | waiting for `api_req_started`      |
| `creating`         | `api_req_started`           | `creating`         | waiting for `session_created`      |
| `creating`         | `process_error`             | `error`            | -                                  |
| `streaming`        | `say:text` (partial)        | `streaming`        | -                                  |
| `streaming`        | `say:text` (complete)       | `streaming`        | -                                  |
| `streaming`        | `ask:tool` (partial)        | `streaming`        | Still streaming the request        |
| `streaming`        | `ask:tool` (complete)       | `waiting_approval` | -                                  |
| `streaming`        | `ask:command` (complete)    | `waiting_approval` | -                                  |
| `streaming`        | `ask:followup` (complete)   | `waiting_input`    | -                                  |
| `streaming`        | `ask:completion_result`     | `completed`        | -                                  |
| `streaming`        | `ask:api_req_failed`        | `error`            | -                                  |
| `streaming`        | `ask:mistake_limit_reached` | `error`            | -                                  |
| `streaming`        | `ask:resume_task`           | `paused`           | -                                  |
| `streaming`        | `cancel_session`            | `stopped`          | -                                  |
| `waiting_approval` | `approve_action`            | `streaming`        | User approves                      |
| `waiting_approval` | `reject_action`             | `streaming`        | User rejects, agent continues      |
| `waiting_approval` | `api_req_started`           | `streaming`        | Auto-approved                      |
| `waiting_approval` | `cancel_session`            | `stopped`          | -                                  |
| `waiting_input`    | `send_message`              | `streaming`        | User responds                      |
| `waiting_input`    | `cancel_session`            | `stopped`          | -                                  |
| `completed`        | `send_message`              | `streaming`        | User continues with follow-up      |
| `completed`        | `start_session`             | `creating`         | User starts new task               |
| `paused`           | `resume_session`            | `streaming`        | -                                  |
| `paused`           | `cancel_session`            | `stopped`          | -                                  |
| `error`            | `retry`                     | `streaming`        | User retries                       |
| `error`            | `cancel_session`            | `stopped`          | -                                  |
| `stopped`          | `resume_session`            | `streaming`        | -                                  |
| `stopped`          | `start_session`             | `creating`         | User starts new task               |
| `*`                | `process_exit` (error)      | `error`            | Non-zero exit code                 |
| `*`                | `process_exit` (success)    | `completed`        | Zero exit code, no pending ask     |

## Derived UI State

From the state machine, we can derive:

| Property              | States where TRUE                                            |
| --------------------- | ------------------------------------------------------------ |
| `showSpinner`         | `creating`, `streaming`                                      |
| `showCancelButton`    | `creating`, `streaming`, `waiting_approval`, `waiting_input` |
| `showResumeButton`    | `paused`, `stopped`, `completed`                             |
| `showAutoModeWarning` | `creating`, `streaming` (when auto-approve enabled)          |
| `inputEnabled`        | `waiting_input`, `completed`, `paused`, `stopped`            |
| `isActive`            | `creating`, `streaming`, `waiting_approval`, `waiting_input` |

## Implementation Notes

### Partial Messages

Partial messages (`partial: true`) should NOT trigger state transitions to waiting states. The agent is still streaming the content of the request. Only when `partial: false` should we consider the request complete and transition.

### Auto-Approve Mode

In auto-approve mode (current default for Agent Manager):

- `waiting_approval` state is transient
- Immediately transitions back to `streaming` when `api_req_started` arrives
- The tool/command is executed without user intervention

### Multiple Sessions

Each session has its own independent state machine. The `sessionStreamingAtom` tracks per-session state.

### State Persistence

State should be derived from:

1. Session status (`creating`, `running`, `done`, `error`, `stopped`)
2. Last complete (non-partial) message's ask type
3. CLI process status

This allows state to be reconstructed when switching between sessions or reloading.
