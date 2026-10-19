# Kilo v1 vs v2: sessions

Companion to *Kilo v1 vs v2: message model and API*, which covers message shapes, the prompt call and streaming chunks. This document covers what changed about **sessions**: the session object, the session endpoints, how a session runs, and how its state is stored.

Compared from the generated client types:
- **v1:** `@kilocode/sdk/v2` (in `packages/sdk/js` on `main`), the SDK entry point used by the v1 VS Code extension. Its calls take flat parameters (`{ sessionID, … }`). Despite the `/v2` in its name, this is the v1 API. It also contains an early, partial copy of the v2 session API under `client.v2.*` (`/api/session/…`, `session.next.*` events), which the v1 extension does not use. The "v1" column describes the API clients actually use.
- **v2:** `packages/client/src/promise/generated/` on `kilo-v2`

The examples use illustrative IDs and values, and leave out optional fields.

## At a glance

| | v1 | v2 |
|---|---|---|
| **How state is stored** | Clients read mutable session, message and part records. A durable event log and a `session_message` projection are also written alongside, but are not the client-facing model | Event-sourced: each session is an ordered log of durable events (with sequence numbers), and messages are projected from that log |
| **How a prompt runs** | The request starts the agent loop directly; one run at a time, cancelled with `abort` | The prompt goes into the session's **inbox**; a separate execution delivers it and runs the model, step by step |
| **Concurrent input** | Prompts sent while busy are queued first-in, first-out (`session.queue.changed` lists them). The classic API has no way to steer a running step and no inbox endpoints | Inbox items can **steer** (delivered at the next safe step boundary) or **queue** (delivered after the run), and can be listed, cancelled or re-prioritised before delivery |
| **Where it runs** | A `directory` (plus optional `workspaceID`) fixed per request | A `location` (`{ directory, workspaceID? }`) stored on the session; it can be **moved** to another location |
| **Agent and model** | Optional fields on the session, overridable on each prompt | Session state, changed with `switchAgent` / `switchModel`; each change is recorded in the timeline |
| **Restart behaviour** | No execution claim; an in-flight run is not resumed after a restart | An execution claim lets the server resume interrupted top-level sessions on startup |

## The session object

| Field area | v1 `Session` | v2 `SessionInfo` |
|---|---|---|
| **Identity** | `id`, `slug`, `projectID`, `version` | `id`, `projectID`. No `slug` or `version` |
| **Location** | `directory`, `workspaceID?`, `path?` | `location: { directory, workspaceID? }`, `subpath?` |
| **Lineage** | `parentID?` (child and subagent sessions) | `parentID?`, plus `fork?: { sessionID, boundary }` recording where it was forked from |
| **Agent and model** | `agent?`, `model?` | `agent?`, `model?` (current session state) |
| **Usage** | `cost?`, `tokens?` | `cost`, `tokens` (always present) |
| **Outcome** | Not on the session; read from `/session/status` | `outcome?: "succeeded" | "failed" | "interrupted"` from the last run |
| **Timestamps** | `created`, `updated`, `compacting?`, `archived?` | `created`, `updated`, `idle?`, `viewed?`, `archived?` |
| **Change summary** | `summary?: { additions, deletions, files, diffs? }` | Not on the session. Diffs come from the VCS and revert APIs |
| **Sharing** | `share?: { url }` | Not in the core. Kilo sharing is a Kilo RPC (`client.kilocode.session.share/unshare`) |
| **Permissions** | `permission?: PermissionRuleset` on the session | Not on the session. Permissions are their own API (requests, saved rules, replies) |
| **Revert** | `revert?: { messageID, partID?, snapshot?, diff?, workspace? }` | `revert?: { messageID, partID?, snapshot?, files? }` |
| **Metadata** | `metadata?` | `metadata?` (JSON values) |

### Example

**v1**

```json
{
  "id": "ses_01",
  "slug": "brave-otter",
  "projectID": "prj_01",
  "directory": "/repo",
  "title": "Explain app.ts",
  "version": "7.8.3",
  "agent": "code",
  "model": { "id": "anthropic/claude-sonnet-4.5", "providerID": "kilo" },
  "time": { "created": 1759770000000, "updated": 1759770004200 },
  "summary": { "additions": 12, "deletions": 3, "files": 2 },
  "share": { "url": "https://app.kilo.ai/s/abc123" },
  "permission": [{ "permission": "edit", "pattern": "*", "action": "ask" }],
  "cost": 0.04,
  "tokens": { "input": 5200, "output": 410, "reasoning": 0, "cache": { "read": 0, "write": 0 } }
}
```

**v2**

```json
{
  "id": "ses_01",
  "projectID": "prj_01",
  "location": { "directory": "/repo" },
  "title": "Explain app.ts",
  "agent": "code",
  "model": { "id": "anthropic/claude-sonnet-4.5", "providerID": "kilo" },
  "cost": 0.04,
  "tokens": { "input": 5200, "output": 410, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
  "outcome": "succeeded",
  "time": { "created": 1759770000000, "updated": 1759770004200, "idle": 1759770004200, "viewed": 1759770005000 },
  "fork": { "sessionID": "ses_00", "boundary": { "type": "through", "messageID": "msg_07" } }
}
```

What changed: the v2 session is smaller and focused on core state. Sharing, the permission ruleset and change summaries moved to their own APIs. The location became structured, and the outcome of the last run and the fork origin are recorded on the session.

## Session endpoints

| Operation | v1 | v2 |
|---|---|---|
| **Create** | `POST /session` `{ parentID?, title?, … }`, with Kilo fields such as `platform`, `metadata` and `sandboxInheritanceToken`; `directory` as a query parameter | `POST /api/session` `{ id?, title?, agent?, model?, location?, metadata? }`. The client may choose the ID; reusing an existing ID adopts that session |
| **List** | `GET /session` (returns an array) | `GET /api/session` with search, filters (`parentID`, `project`, `directory`, `workspace`), ordering and **cursor pagination** |
| **Children** | `GET /session/{id}/children` | `GET /api/session?parentID=…` |
| **Get / delete** | `GET` / `DELETE /session/{id}` | `GET` / `DELETE /api/session/{sessionID}` |
| **Rename** | `PATCH /session/{id}` `{ title }` | `POST /api/session/{sessionID}/rename` |
| **Status** | `GET /session/status` (map of `idle` / `busy` / `retry`) | `GET /api/session/active`, `outcome` on the session, and `session.status` events (still `idle` / `busy` / `retry`) |
| **Prompt** | `POST /session/{id}/message` or `/prompt_async` | `POST /api/session/{sessionID}/prompt` (admission to the inbox) |
| **Manage queued input** | No public endpoints in the classic API; the queue is reported through `session.queue.changed` | `GET /api/session/{id}/inbox`, `DELETE …/inbox/{inboxID}`, `POST …/inbox/{inboxID}/steer` and `/queue` |
| **Stop** | `POST /session/{id}/abort` | `POST /api/session/{sessionID}/interrupt`; with `?continue=true` it then carries on with pending steer input while queued prompts wait. `POST …/background` moves running blocking tools to the background |
| **Wait for idle** | Watch events | `POST /api/session/{sessionID}/wait` |
| **Agent / model** | Per prompt | `POST /api/session/{id}/agent`, `POST /api/session/{id}/model` |
| **Move location** | n/a | `POST /api/session/{sessionID}/move` `{ directory, workspaceID?, delivery? }` |
| **Compact** | `POST /session/{id}/summarize` `{ providerID, modelID }` | `POST /api/session/{sessionID}/compact` `{ id?, delivery? }` (queued like other inbox items) |
| **Fork** | `POST /session/{id}/fork` `{ messageID? }` | `POST /api/session/{sessionID}/fork` `{ boundary: { type: "before" | "through", messageID } }` |
| **Revert** | `POST /session/{id}/revert` `{ messageID, partID? }`, then `/unrevert` | Three steps: `…/revert/stage` `{ messageID, files? }`, then `…/revert/clear` (undo) or `…/revert/commit` (make permanent) |
| **Messages** | `GET /session/{id}/message`, plus `/message/{messageID}` and part update/delete routes | `GET /api/session/{id}/message` (cursor pagination), `GET` / `PATCH …/message/{messageID}`. No part routes |
| **Share** | `POST` / `DELETE /session/{id}/share` | Kilo RPC: `client.kilocode.session.share/unshare` |
| **Permission reply** | `POST /session/{id}/permissions/{permissionID}` | Permission API: `client.permission.reply(…)`; questions use forms |
| **Diff** | `GET /session/{id}/diff` | No session diff endpoint; use `client.vcs.diff(…)` and the revert staging result |
| **Import / export** | n/a | `POST /api/session/import`, `GET /api/session/{id}/export` |
| **New in v2** | n/a | `context` (what the model will see), `instructions/entries`, `generate` (one-off text), `environment` (session variables), `view` (mark viewed), `stats`, and `log` (experimental) |

The v1 SDK also exposes Kilo-specific session routes (`branch-name`, `model-usage`, `sandbox`, `viewed`). v2 covers "viewed" natively (`view`). Per-session model usage is a Kilo RPC in the v2 port. v2's `stats` endpoint reports aggregate statistics across sessions, not one session's usage. The remaining routes are Kilo features tracked in the migration plan.

## Example: start a session, prompt it, stop it

**v1**

```ts
const { data: session } = await client.session.create({ title: "Explain app.ts", directory: "/repo" })

await client.session.promptAsync({
  sessionID: session.id,
  agent: "code",
  model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4.5" },
  parts: [{ type: "text", text: "Explain src/app.ts" }],
})
// On /global/event: session.status { type: "busy" } … message.part.* updates … session.idle

await client.session.abort({ sessionID: session.id })
```

**v2**

```ts
const session = await client.session.create({
  title: "Explain app.ts",
  agent: "code",
  model: { id: "anthropic/claude-sonnet-4.5", providerID: "kilo" },
  location: { directory: "/repo" },
})

await client.session.prompt({ sessionID: session.id, text: "Explain @src/app.ts", delivery: "steer" })
// On /api/event:
//   session.inbox.enqueued → session.inbox.delivered → session.execution.started
//   → session.step.started / session.text.delta / session.tool.* …
//   → session.execution.succeeded → session.idle

await client.session.interrupt({ sessionID: session.id })
// → session.execution.interrupted; outcome becomes "interrupted"
```

## Example: sending input while the session is running

**v1:** the classic API has no way to steer a running step. Prompts sent while busy wait in a first-in, first-out queue; the client can't promote them.

**v2:**

```ts
// Delivered at the next safe step boundary, so the model sees it mid-run:
await client.session.prompt({ sessionID: "ses_01", text: "Also check the tests", delivery: "steer" })

// Delivered only after the current run finishes:
const queued = await client.session.prompt({ sessionID: "ses_01", text: "Then write a summary", delivery: "queue" })

// Before delivery, queued input can be inspected, promoted or cancelled:
await client.session.inbox.list({ sessionID: "ses_01" })
await client.session.inbox.steer({ sessionID: "ses_01", inboxID: queued.id })
await client.session.inbox.cancel({ sessionID: "ses_01", inboxID: queued.id })
```

## Example: revert

**v1:** a single call reverts, and a second call undoes it.

```ts
await client.session.revert({ sessionID: "ses_01", messageID: "msg_05" })
await client.session.unrevert({ sessionID: "ses_01" })
```

**v2:** revert is staged first, so a client can show the result before deciding.

```ts
const staged = await client.session.revert.stage({ sessionID: "ses_01", messageID: "msg_05" })
// staged.files lists the file changes that would be undone

await client.session.revert.commit({ sessionID: "ses_01" }) // make it permanent
// or
await client.session.revert.clear({ sessionID: "ses_01" })  // cancel the staged revert
```

## Session lifecycle events

| Moment | v1 event | v2 events |
|---|---|---|
| Prompt accepted | (none; the prompt call itself) | `session.inbox.enqueued` |
| Prompt handed to the model | (none) | `session.inbox.delivered` (the message becomes visible) |
| Run starts | `session.status` `{ type: "busy" }` | `session.execution.started`, `session.status` `{ type: "busy" }` |
| Each model call | `step-start` / `step-finish` parts via `message.part.updated` | `session.step.started`, `session.step.ended` / `session.step.failed` |
| Retry | `session.status` `{ type: "retry", attempt, next }` | `session.retry.scheduled`, `session.status` `{ type: "retry", … }` |
| Run ends | `session.idle` | `session.execution.succeeded` / `failed` / `interrupted`, then `session.idle` |
| Compaction | `time.compacting` set on the session | `session.compaction.started` / `delta` / `ended` / `failed` |
| Agent or model change | `session.updated` | `session.agent.selected` / `session.model.selected` |
| Revert | `session.updated` | `session.revert.staged` / `cleared` / `committed` |
| Fork / move | `session.created` | `session.forked` / `session.moved` |

## What this means for clients

- **Session list and detail views:** read `location`, `outcome`, `fork` and the new timestamps. Get sharing, permissions and diffs from their own APIs.
- **The "busy" indicator and Stop button:** drive them from execution events and `outcome`, use `interrupt` instead of `abort`, and decide how to present steer and queue input (an inbox view).
- **Agent and model pickers:** call `switchAgent` / `switchModel` on the session instead of passing them with each prompt.
- **Revert:** move to stage, then commit or clear, which allows a preview step.
- **Reconnects and restarts:** rebuild session state from sequenced durable events. A run interrupted by a server restart may resume by itself.
