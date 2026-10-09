# Kilo v1 vs v2: message model and API

Compared from the generated client types:
- **v1:** `@kilocode/sdk/v2` (in `packages/sdk/js` on `main`), the SDK entry point used by the v1 VS Code extension. Its calls take flat parameters (`{ sessionID, … }`). Despite the `/v2` in its name, this is the v1 API. It also contains an early, partial copy of the v2 session API under `client.v2.*` (`/api/session/…`, `session.next.*` events), which the v1 extension does not use. The "v1" column describes the API clients actually use.
- **v2:** `packages/client/src/promise/generated/types.ts` on `kilo-v2`

The examples use illustrative IDs and values, and leave out optional fields. Their shapes follow the generated types.

## Messages

| | v1 | v2 |
|---|---|---|
| **Structure** | A message is `{ info, parts[] }`. `info` is a `UserMessage` or `AssistantMessage` (told apart by `role`); each part is a separate record with its own `id`, `sessionID` and `messageID` | One record per message, told apart by `type`, with its content embedded |
| **Message kinds** | 2: user and assistant | 10: `user`, `assistant`, `synthetic`, `system`, `skill`, `shell`, `compaction`, plus timeline markers `agent-switched`, `model-switched` and `location-switched` |
| **User message** | Content lives in parts: text, file, agent and subtask parts | `text` plus attachments: `files`, `agents`, `skills` |
| **Assistant message** | Parts: text, reasoning, tool, step-start/finish, snapshot, patch, retry and others | `content[]` holding text, reasoning and tool entries, plus `agent`, `model`, `snapshot`, `finish`, `cost`, `tokens`, `error` and `retry` on the message itself |
| **Tool state** | Kept inside the tool part; a completed tool's result is an `output` string | Explicit states (`streaming`, `running`, `completed`, `error`); a completed tool's result is a `content[]` of text and file entries |

### Example: an assistant message that replies and calls a tool

**v1** (one item from `GET /session/{id}/message`):

```json
{
  "info": {
    "id": "msg_02",
    "sessionID": "ses_01",
    "role": "assistant",
    "parentID": "msg_01",
    "agent": "code",
    "mode": "code",
    "providerID": "kilo",
    "modelID": "anthropic/claude-sonnet-4.5",
    "path": { "cwd": "/repo", "root": "/repo" },
    "time": { "created": 1759770000000, "completed": 1759770004200 },
    "cost": 0.0123,
    "tokens": { "input": 1200, "output": 85, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
    "finish": "tool-calls"
  },
  "parts": [
    {
      "id": "prt_10",
      "sessionID": "ses_01",
      "messageID": "msg_02",
      "type": "text",
      "text": "Let me read the file."
    },
    {
      "id": "prt_11",
      "sessionID": "ses_01",
      "messageID": "msg_02",
      "type": "tool",
      "callID": "call_1",
      "tool": "read",
      "state": {
        "status": "completed",
        "input": { "filePath": "/repo/src/app.ts" },
        "output": "…file contents…",
        "title": "src/app.ts",
        "metadata": {},
        "time": { "start": 1759770001000, "end": 1759770001150 }
      }
    }
  ]
}
```

**v2** (one item from `GET /api/session/{sessionID}/message`):

```json
{
  "type": "assistant",
  "id": "msg_02",
  "agent": "code",
  "model": { "id": "anthropic/claude-sonnet-4.5", "providerID": "kilo" },
  "time": { "created": 1759770000000, "streamed": 1759770000400, "completed": 1759770004200 },
  "content": [
    { "type": "text", "text": "Let me read the file." },
    {
      "type": "tool",
      "id": "call_1",
      "name": "read",
      "executed": true,
      "state": {
        "status": "completed",
        "input": { "filePath": "/repo/src/app.ts" },
        "content": [{ "type": "text", "text": "…file contents…" }]
      },
      "time": { "created": 1759770000900, "ran": 1759770001000, "completed": 1759770001150 }
    }
  ],
  "finish": "tool-calls",
  "cost": 0.0123,
  "tokens": { "input": 1200, "output": 85, "reasoning": 0, "cache": { "read": 0, "write": 0 } }
}
```

What changed: there are no separate part records with their own IDs; content is embedded in the message. Model and agent are fields on the message. A tool's result is structured content instead of an output string.

## Prompt API

| | v1 | v2 |
|---|---|---|
| **Endpoint** | `POST /session/{id}/message` (or `/prompt_async`) | `POST /api/session/{sessionID}/prompt` |
| **Input** | `parts[]`, with optional `model`, `agent`, `system`, `tools`, `noReply`, `format`, plus Kilo fields such as `variant` and `editorContext`, per prompt | `text`, `files`, `agents`, `skills`, `metadata`, `delivery` (`steer` or `queue`) and `resume` |
| **What it returns** | The finished assistant message (the async variant returns nothing) | An inbox item showing the prompt was **accepted**; the model runs separately |
| **Model and agent choice** | Can be set on each prompt | Belongs to the session. Changed with `POST /api/session/{id}/model` and `/agent`, which add `model-switched` / `agent-switched` messages to the timeline |

### Example: ask about a file

**v1**

```ts
const reply = await client.session.prompt({
  sessionID: "ses_01",
  agent: "code",
  model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4.5" },
  parts: [
    { type: "text", text: "Explain src/app.ts" },
    { type: "file", mime: "text/plain", filename: "app.ts", url: "file:///repo/src/app.ts" },
  ],
})
// reply.data → { info: AssistantMessage, parts: Part[] }: the finished answer, after the whole run
```

**v2**

```ts
// The model is session state, set separately (only when it changes):
await client.session.switchModel({
  sessionID: "ses_01",
  model: { id: "anthropic/claude-sonnet-4.5", providerID: "kilo" },
})

const admitted = await client.session.prompt({
  sessionID: "ses_01",
  text: "Explain @src/app.ts",
  files: [
    {
      uri: "file:///repo/src/app.ts",
      name: "app.ts",
      mention: { start: 8, end: 19, text: "@src/app.ts" },
    },
  ],
  delivery: "steer",
})
// admitted → { id: "msg_01", sessionID: "ses_01", type: "user", payload: { text, files }, delivery: "steer", timeCreated }
// This only confirms the prompt was queued. The answer arrives on the event stream.
```

What changed: v1 returns the answer, while v2 returns an admission receipt. Files are attached by URI with mention offsets instead of as typed parts. Model and agent are no longer per-prompt fields.

## Streaming updates

| | v1 | v2 |
|---|---|---|
| **Endpoint** | `/event` (one directory) or `/global/event` (all directories; used by the VS Code extension) | `/api/event` |
| **Event envelope** | `{ id, type, properties }`; on `/global/event` wrapped as `{ directory, payload }` | `{ id, created, type, data }`, plus `location` and, on durable events, `durable: { aggregateID, seq, version }` |
| **Updates** | Whole-record events: `message.updated` and `message.part.updated`, plus `message.part.delta` | Fine-grained events: `session.text.delta`, `session.reasoning.delta`, `session.tool.input.*`, `session.tool.called/success/failed`, `session.step.*`, and others |
| **Lifecycle** | `session.status`, `session.idle` | `session.inbox.enqueued/delivered`, `session.execution.started/succeeded/failed/interrupted`, plus `session.status` and `session.idle` |
| **Ordering** | Classic events (`message.*`, `session.*`) have no sequence numbers. Durable events also arrive as `type: "sync"` payloads with `seq` and `aggregateID`, alongside the classic events | Every durable event carries `durable.seq`, and `session.message.content.updated` carries a full-content snapshot, so clients can rebuild state after reconnecting. Streaming deltas are not durable |

### Example: a text chunk, then a finished tool call

**v1** (server-sent events on `/event`):

```text
data: {"id":"evt_1","type":"message.part.delta","properties":{"sessionID":"ses_01","messageID":"msg_02","partID":"prt_10","field":"text","delta":"Let me "}}

data: {"id":"evt_2","type":"message.part.updated","properties":{"sessionID":"ses_01","time":1759770001150,"part":{"id":"prt_11","sessionID":"ses_01","messageID":"msg_02","type":"tool","callID":"call_1","tool":"read","state":{"status":"completed","input":{"filePath":"/repo/src/app.ts"},"output":"…file contents…","title":"src/app.ts","metadata":{},"time":{"start":1759770001000,"end":1759770001150}}}}}
```

**v2** (server-sent events on `/api/event`):

```text
data: {"id":"evt_1","created":1759770000400,"type":"session.text.delta","data":{"sessionID":"ses_01","assistantMessageID":"msg_02","ordinal":0,"delta":"Let me "}}

data: {"id":"evt_2","created":1759770001150,"type":"session.tool.success","durable":{"aggregateID":"ses_01","seq":42,"version":2},"data":{"sessionID":"ses_01","assistantMessageID":"msg_02","id":"call_1","content":[{"type":"text","text":"…file contents…"}],"executed":true}}
```

What changed:
- v1 sends a whole updated part, and the client replaces its copy.
- v2 sends a small, specific event (delta, tool success, and so on) that the client applies to its state.
- Deltas are addressed by message and position (`ordinal`) instead of part ID.
- In v2, every durable event carries its sequence number as part of the one event stream; in v1, sequenced events were a separate `sync` side channel next to the classic events.

## What this means for clients

A v1 client can't simply be pointed at a v2 server. It has to rework three things:

- **Rendering:** draw the timeline from typed messages with embedded content, instead of message-plus-parts records.
- **Prompting:** send prompts as admission plus events, and change model or agent through session-level calls instead of per-prompt fields.
- **State:** rebuild client state from the fine-grained, sequenced event stream.


These differences are why each client's backend has to be rebuilt on the v2 client, rather than pointed at the new server.

On `kilo-v2`, the VS Code extension host has been rewritten onto the v2 client (`connection.ts` and the `backend/*` modules use `@opencode-ai/client`). The original webviews deliberately keep their v1-shaped message/part contract: the host projects v2 state into that format, with the v1 view types kept in `packages/kilo-client/src/ide-types.ts` (see `technical-notes/baseline/existing-vscode-port.md`). The remote relay uses the same adapter approach toward cloud consumers (`technical-notes/baseline/remote-share-next-contracts.md`). Gaps in these projections (for example, the missing completed-tool `title` and the user message's `agent`/`model`) are tracked in those notes.


It also explains why the migration plan forbids mixing v1 and v2 routes within one session (Decision 7).
