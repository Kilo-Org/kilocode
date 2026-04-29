# Symphony Autonomous Daemon — Design Specification

**Date:** 2026-04-28
**Status:** Draft
**Approach:** Symphony-Compatible Hybrid — Symphony's external contract with Devil Code internals

## Context

Devil Code has a mature multi-agent infrastructure (DAG-based workflow engine, team roles, session hierarchy, tool system, HTTP API) but it's entirely interactive/user-driven. OpenAI's Symphony project introduces an autonomous orchestration pattern: a daemon that monitors issue trackers, spawns isolated agent sessions per work item, and handles retry/stall/reconciliation without human supervision.

This spec adds a full Symphony-compatible autonomous daemon to Devil Code as a parallel system alongside the existing interactive workflow. The daemon follows Symphony's external contract (WORKFLOW.md config, Linear integration, HTTP status API, lifecycle semantics) while leveraging Devil Code's existing agent runtime, session management, provider layer, and tool system internally.

## Requirements

| Decision | Choice |
|----------|--------|
| Scope | Full autonomous daemon |
| Tracker | Linear (GraphQL API) |
| Workflow relation | Parallel system (separate from existing DAG workflow) |
| Runtime | CLI subcommand (`kilo symphony`) |
| Workspace isolation | Separate directories (Symphony-style) |
| Config format | Both WORKFLOW.md + team config with bidirectional adapter |
| Monitoring | HTTP dashboard + REST API |
| Verification | Agent-driven (agents use bash/git tools directly) |
| Agent model | Dedicated `symphony` agent with autonomous-optimized permissions |
| Target scale | 1–5 concurrent agents |

---

## 1. Architecture Overview

```
                    Linear (GraphQL API)
                           │
                    ┌──────┴──────┐
                    │ Orchestrator │  ← kilo symphony (CLI subcommand)
                    │ (Poll Loop)  │
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐
         │Worker #1│ │Worker #2│ │Worker #3│  ← One per active issue
         │(Session)│ │(Session)│ │(Session)│
         └────┬────┘ └────┬────┘ └────┬────┘
              │            │            │
              ▼            ▼            ▼
         workspace/    workspace/    workspace/
         PROJ-123/     PROJ-456/     PROJ-789/
              │            │            │
              └────────┬───┘────────────┘
                       ▼
              Shared Agent Infrastructure
              (providers, tools, MCP, Bus)
```

### Key Boundaries

- **Orchestrator**: Owns poll loop, dispatch decisions, retry queue, reconciliation. New code.
- **Workers**: Thin wrappers around Devil Code sessions. Each worker owns one session in one workspace for one issue.
- **Shared infrastructure**: Existing provider, tool, permission, Bus, and session systems. No changes needed.
- **Config layer**: WORKFLOW.md parser + adapter to/from CanonicalTeamConfig. New code.
- **HTTP surface**: New routes under `/symphony/` on existing Hono server.

The daemon runs as `kilo symphony` CLI subcommand. Starts Hono server (reusing existing bootstrap), initializes orchestrator, begins polling. Ctrl+C triggers graceful shutdown.

---

## 2. Core Daemon Loop

Tick-based lifecycle. Each tick runs these phases in order:

### 2.1 Reconcile
For each running worker: check if its issue is still active in Linear.
- Terminal state → stop worker, clean workspace
- Still active → update cached issue snapshot
- Stalled (`now - last_event_at > stall_timeout_ms`) → terminate worker, queue retry

### 2.2 Validate
Confirm WORKFLOW.md readable, Linear credentials valid, agent executable available. If validation fails → skip dispatch, continue reconciliation.

### 2.3 Fetch Candidates
Query Linear GraphQL for issues in `active_states` for configured `project_slug`. Filter out already-running and claimed issues.

### 2.4 Sort
Priority ascending → `created_at` oldest-first → identifier lexicographic tiebreaker.

### 2.5 Dispatch
While concurrent slots available (`max_concurrent_agents - running.size > 0`), claim next candidate and spawn a worker.

### 2.6 Schedule Next Tick
Wait `poll_interval_ms` (default 30000ms, runtime-configurable via WORKFLOW.md hot reload).

### 2.7 State Tracking (In-Memory)

```typescript
interface OrchestratorState {
  running: Map<string, RunningEntry>
  claimed: Set<string>
  retryQueue: Map<string, RetryEntry>
  tokenTotals: TokenAccounting
  rateLimits: RateLimitSnapshot | null
}

interface RunningEntry {
  issueId: string
  identifier: string
  state: string
  sessionId: string
  workspacePath: string
  turnCount: number
  startedAt: number
  lastEventAt: number
  tokens: { input: number; output: number; total: number }
}

interface TokenAccounting {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  secondsRunning: number
}
```

Uses `Instance.state()` for lifecycle management. Bus events for internal communication.

### 2.8 Retry Policy
- Normal completion (agent finished, issue still active) → 1s delay, re-check
- Abnormal failure → exponential backoff: `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`
- Default `max_retry_backoff_ms`: 300000 (5 min)

### 2.9 Recovery After Restart
No durable orchestrator state. On restart: poll Linear fresh, reuse existing workspaces, re-dispatch eligible issues.

---

## 3. Linear Integration

### 3.1 Tracker Interface

```typescript
interface Tracker {
  fetchCandidates(activeStates: string[], projectSlug: string): Promise<TrackerIssue[]>
  fetchIssueStates(issueIds: string[]): Promise<Map<string, string>>
  fetchTerminalIssues(terminalStates: string[], projectSlug: string): Promise<TrackerIssue[]>
}
```

Generic interface. Linear is first implementation; others can follow without architectural changes.

### 3.2 TrackerIssue Model

```typescript
interface TrackerIssue {
  id: string
  identifier: string        // e.g., "PROJ-123"
  title: string
  description: string | null
  priority: number | null
  state: string
  branchName: string | null
  url: string
  labels: string[]
  blockedBy: BlockerRef[]
  createdAt: string
  updatedAt: string
}

interface BlockerRef {
  id: string
  identifier: string
  state: string
}
```

### 3.3 Linear Client Details
- Endpoint: `https://api.linear.app/graphql` (configurable)
- Auth: `Authorization: Bearer <token>` from `tracker.api_key` or `$LINEAR_API_KEY` env var
- Project filter: `project: { slugId: { eq: $projectSlug } }`
- Pagination: cursor-based, page size 50
- Network timeout: 30000ms
- Default `active_states`: `["Todo", "In Progress"]`
- Default `terminal_states`: `["Closed", "Cancelled", "Done", "Duplicate"]`

### 3.4 Issue Eligibility
An issue dispatches when:
- Required fields present (id, identifier, title, state)
- State in `active_states`, not in `terminal_states`
- Not already running or claimed
- Concurrency slots available
- If state is "Todo": no non-terminal blockers

### 3.5 linear_graphql Tool
Available to symphony agent for updating issue state, posting comments, linking PRs. Uses daemon's configured Linear credentials.

**Contract:**
- Input: `{ query: string, variables?: Record<string, unknown> }` — one GraphQL operation per call
- Output: `{ success: boolean, data?: unknown, errors?: unknown[] }`
- Auth: reuses `tracker.api_key` from daemon config (agent doesn't need its own credentials)
- Registered via `Tool.define("linear_graphql", ...)` — only available when agent has `symphony` in options

---

## 4. Workspace Management

### 4.1 Directory Structure
```
<workspace_root>/           # Configurable, defaults to OS temp dir
  PROJ-123/                 # Sanitized issue identifier
  PROJ-456/
```

Sanitization: replace non-alphanumeric chars (except `.`, `_`, `-`) with underscore. Path MUST stay under configured root (enforced).

### 4.2 Lifecycle Hooks

| Hook | When | Failure |
|------|------|---------|
| `after_create` | First workspace creation | Aborts dispatch |
| `before_run` | Before each agent attempt | Aborts attempt |
| `after_run` | After each agent attempt | Ignored (logged) |
| `before_remove` | Before workspace cleanup | Ignored (logged) |

All hooks: `timeout_ms` default 60000. Run via `Process.spawn` (existing wrapper with `windowsHide: true`). CWD = workspace directory.

### 4.3 WorkspaceManager Interface

```typescript
interface WorkspaceManager {
  prepare(issue: TrackerIssue): Promise<{ path: string; isNew: boolean }>
  cleanup(issueIdentifier: string): Promise<void>
  cleanupTerminal(terminalIdentifiers: string[]): Promise<void>
  getPath(issueIdentifier: string): string
}
```

### 4.4 Cleanup
- Issue reaches terminal state → `before_remove` hook → delete directory
- Daemon startup → fetch terminal issues → clean stale workspaces
- Configurable: `workspace.cleanup: true|false` (default true)

---

## 5. Dedicated Symphony Agent

### 5.1 Agent Definition

```typescript
{
  name: "symphony",
  displayName: "Symphony Agent",
  description: "Autonomous coding agent for unattended issue resolution",
  mode: "primary",
  native: true,
  model: { providerID, modelID },  // from WORKFLOW.md agent.model or team config
  permission: {
    bash: "allow",
    read: "allow",
    edit: "allow",
    write: "allow",
    glob: "allow",
    grep: "allow",
    question: "deny",           // no user to ask
    plan_enter: "deny",         // no interactive plan mode
    external_directory: "deny", // workspace-scoped
    mcp: "allow",
  }
}
```

### 5.2 Key Differences from `code` Agent
1. **No user interaction** — `question` permission denied; agent decides autonomously
2. **Workspace-scoped** — `external_directory` denied; stays in assigned workspace
3. **Auto-commit prompt** — system prompt instructs commit, push, PR creation
4. **Turn limit** — `max_turns` (default 20) caps runaway sessions
5. **Custom tools** — `linear_graphql` tool for issue state updates

### 5.3 Prompt Template Rendering
WORKFLOW.md body rendered with Liquid-compatible strict mode:
- `{{ issue.identifier }}`, `{{ issue.title }}`, `{{ issue.description }}`
- `{{ issue.branch_name }}`, `{{ issue.labels }}`, `{{ issue.url }}`
- `{{ attempt }}` (null on first run, integer on retry)

Unknown variables/filters → render failure (strict mode).

### 5.4 Session Lifecycle
First turn: full rendered prompt. Continuation turns (after clean exit + re-check): shorter guidance without re-sending full context. Session reused within one worker lifetime up to `max_turns`.

---

## 6. Config System

### 6.1 WORKFLOW.md (Symphony-Compatible)
Markdown with YAML frontmatter + prompt template body.

Discovery:
1. CLI flag: `kilo symphony --workflow <path>`
2. Default: `./WORKFLOW.md`

```yaml
---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states: [Todo, In Progress]
  terminal_states: [Closed, Cancelled, Done, Duplicate]
polling:
  interval_ms: 30000
workspace:
  root: ./workspaces
  cleanup: true
hooks:
  after_create: |
    git clone git@github.com:org/repo.git .
  before_run: |
    git fetch origin && git rebase origin/main
  timeout_ms: 60000
agent:
  max_concurrent_agents: 5
  max_turns: 20
  max_retry_backoff_ms: 300000
  model: anthropic/claude-sonnet-4-6
server:
  port: 0
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

Branch: {{ issue.branch_name }}
```

### 6.2 Team Config Extension
Add `symphony` key to `CanonicalTeamConfig` schema with equivalent fields.

### 6.3 Adapter Layer
- `parseWorkflowMd(content: string)` → `SymphonyConfig`
- `teamConfigToSymphony(team: CanonicalTeamConfig)` → `SymphonyConfig`
- `symphonyToTeamConfig(symphony: SymphonyConfig)` → partial `CanonicalTeamConfig`
- Zod validation on merged result

### 6.4 Dynamic Reload
File watcher detects WORKFLOW.md changes. Re-validate and hot-reload config. Running workers continue with original config; new dispatches use new config. Invalid reloads keep last known good config and log error.

---

## 7. HTTP API & Dashboard

Routes on existing Hono server under `/symphony/` prefix.

### 7.1 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/symphony/state` | Full orchestrator state snapshot |
| `GET` | `/symphony/issue/:identifier` | Issue-specific debug details |
| `POST` | `/symphony/refresh` | Trigger immediate poll + reconciliation |
| `GET` | `/symphony/dashboard` | HTML dashboard page |
| `GET` | `/symphony/config` | Current effective config |

### 7.2 State Snapshot

```json
{
  "generated_at": "2026-04-28T12:00:00Z",
  "counts": { "running": 2, "retrying": 1 },
  "running": [
    {
      "issue_id": "abc123",
      "identifier": "PROJ-123",
      "state": "In Progress",
      "session_id": "sess_xxx",
      "turn_count": 3,
      "started_at": "...",
      "last_event_at": "...",
      "tokens": { "input": 50000, "output": 12000, "total": 62000 }
    }
  ],
  "retrying": [
    {
      "issue_id": "def456",
      "identifier": "PROJ-456",
      "attempt": 2,
      "due_at": "...",
      "error": "Agent session timed out"
    }
  ],
  "token_totals": { "input": 200000, "output": 45000, "total": 245000, "seconds_running": 3600 },
  "rate_limits": null
}
```

### 7.3 Dashboard
Static HTML + inline CSS + `fetch()`. Shows running agents, retry queue, aggregate tokens, last poll time. Auto-refreshes every 10s.

### 7.4 Bus Events

| Event | Payload |
|-------|---------|
| `SymphonyWorkerStarted` | `{ issueId, identifier, sessionId, workspacePath }` |
| `SymphonyWorkerCompleted` | `{ issueId, identifier, sessionId, turnCount, tokens }` |
| `SymphonyWorkerFailed` | `{ issueId, identifier, error, attempt }` |
| `SymphonyStallDetected` | `{ issueId, identifier, lastEventAt }` |
| `SymphonyConfigReloaded` | `{ source: "workflow_md" | "team_config" }` |

---

## 8. Error Handling & Retry

### 8.1 Error Classification

| Class | Examples | Response |
|-------|----------|----------|
| Config failure | Bad WORKFLOW.md, missing credentials | Block dispatch, keep running workers |
| Workspace failure | Hook failed, dir creation failed | Fail attempt, queue retry |
| Agent failure | Session error, turn timeout | Queue exponential retry |
| Tracker failure | Linear API down, auth expired | Skip candidate fetch, continue reconciliation |
| Observability failure | Dashboard error, log sink failure | Never crash orchestrator |

### 8.2 Stall Detection
Every tick: check `last_event_at` per worker. If `now - last_event_at > stall_timeout_ms` (default 300s) → terminate, queue retry. Publish `SymphonyStallDetected`. Disable with `stall_timeout_ms ≤ 0`.

### 8.3 Retry Queue

```typescript
interface RetryEntry {
  issueId: string
  identifier: string
  attempt: number       // 1-based
  dueAtMs: number       // monotonic clock
  error: string
  timerHandle: Timer
}
```

Timer fires → re-fetch issue from Linear → still active: re-dispatch / terminal: release + clean / missing: release.

### 8.4 Concurrency Limits

```
global_slots = max(max_concurrent_agents - running.size, 0)
per_state_slots = max_concurrent_agents_by_state[state] ?? global_limit
available = min(global_slots, per_state_slots - count_by_state)
```

### 8.5 Graceful Shutdown
SIGINT/SIGTERM → stop new dispatches → cancel retry timers → wait for current turns (with timeout) → cleanup → exit.

### 8.6 Named Errors
- `SymphonyConfigError`
- `SymphonyTrackerError`
- `SymphonyWorkspaceError`
- `SymphonyDispatchError`
- `SymphonyStallError`

---

## 9. Module Structure

```
packages/opencode/src/devilcode/symphony/
├── index.ts                    # Public API barrel export
├── orchestrator.ts             # Core daemon loop
├── worker.ts                   # Per-issue worker (session lifecycle)
├── state.ts                    # OrchestratorState + Instance.state()
├── types.ts                    # Shared types
├── errors.ts                   # NamedError definitions
│
├── config/
│   ├── schema.ts               # SymphonyConfig Zod schema
│   ├── workflow-md.ts          # WORKFLOW.md parser
│   ├── adapter.ts              # WORKFLOW.md ↔ team config adapter
│   └── watcher.ts              # File watcher for hot reload
│
├── tracker/
│   ├── tracker.ts              # Tracker interface
│   ├── linear.ts               # Linear GraphQL client
│   └── types.ts                # TrackerIssue, BlockerRef schemas
│
├── workspace/
│   ├── manager.ts              # WorkspaceManager
│   └── hooks.ts                # Hook runner
│
├── agent/
│   ├── definition.ts           # Symphony agent registration
│   ├── prompt.ts               # Liquid template rendering
│   └── tools/
│       └── linear-graphql.ts   # linear_graphql tool
│
├── server/
│   ├── routes.ts               # Hono routes (/symphony/*)
│   └── dashboard.ts            # HTML dashboard
│
├── events.ts                   # BusEvent definitions
└── cli.ts                      # CLI subcommand
```

### Integration with Existing Code

| File | Change |
|------|--------|
| `agent/agent.ts` | Register `symphony` in built-in agents |
| `cli/cmd/` | Add `symphony` subcommand |
| `server/server.ts` | Mount `/symphony/` routes |
| `tool/registry.ts` | Register `linear_graphql` (symphony agent only) |
| `devilcode/team/config.ts` | Add `symphony` key to CanonicalTeamConfig |

---

## 10. Testing Strategy

### Unit Tests
- Config parsing: WORKFLOW.md parser, adapter bidirectional conversion, Zod validation
- Tracker: Linear GraphQL query building, issue eligibility, state mapping
- Workspace: path sanitization, containment checks, hook timeout
- Orchestrator: sort order, concurrency slot calculation, retry backoff formula
- Prompt: Liquid template rendering, strict mode failures

### Integration Tests
- Full tick cycle with mocked Linear API
- Worker lifecycle (spawn → run → complete/fail)
- Config hot reload
- Stall detection triggering
- Graceful shutdown

### Manual Verification
- Create Linear project with test issues
- Run `kilo symphony` with sample WORKFLOW.md
- Verify agent picks up issues, creates workspaces, runs sessions
- Move issue to terminal state → verify cleanup
- Check HTTP dashboard renders correctly
- Kill daemon → restart → verify re-dispatch

---

## 11. Future Extensions (Out of Scope)

- GitHub Issues tracker implementation
- Jira tracker implementation
- VS Code extension dashboard integration
- Queue-based dispatch for large scale
- Cost budget limits per issue/project
- Webhook-based triggers (instead of polling)
- Multi-repo workspace support
