# ZeroClaw Webview Handler — Live Wiring

## What it does

The ZeroClawTab gains a **remote approval queue** — tasks running on the
Hub-side ZeroClaw worker that are blocked on human approval. Three
operations:

1. **List queue** — pulls all tasks waiting for human approval from the
   Hub-side ZeroClaw service (typically high-risk shell commands or
   buffered diffs from background agents).
2. **Approve** — releases a queued task to execute, recording the approver.
3. **Reject** — declines a queued task with an optional reason.

The local in-process `ZeroClawService` still owns IDE-submitted tasks
(submit/cancel/retry). This handler adds the cross-machine federation: when
a researcher agent on a different host hits a high-risk gate, it lands in
this queue and any approved IDE can clear it.

## Wire diagram

```
ZeroClawTab.tsx
   │
   │  vscode.postMessage({ type: "zeroclaw.queue" })
   │  vscode.postMessage({ type: "zeroclaw.approve", task_id, approver })
   │  vscode.postMessage({ type: "zeroclaw.reject",  task_id, reason })
   ▼
KiloProvider → __daveExtensions.handleV4Message
   │  zeroclaw.* prefix → handleZeroClawRealWebviewMessage
   ▼
zeroclaw-webview.ts
   │  fetch(`${HUB_BASE}/zeroclaw/queue`)
   │  fetch(`${HUB_BASE}/zeroclaw/approve`, POST { task_id, approver })
   │  fetch(`${HUB_BASE}/zeroclaw/reject`,  POST { task_id, reason })
   ▼
ZeroClaw service (https://hermes.daveai.tech/zeroclaw/*)
   │  marks task approved/rejected, dispatches to executor
   ▼
postMessage({ type: "zeroclaw.update", payload: { kind, ... } })
   ▼
ZeroClawTab.tsx live panel re-renders + auto-refreshes queue
```

## How to test locally

1. Set Hub base + key:
   ```bash
   export KILO_HUB_BASE="https://hermes.daveai.tech"
   ```

2. Direct curl:
   ```bash
   curl -H "Authorization: Bearer $HERMES_API_KEY" \
        https://hermes.daveai.tech/zeroclaw/queue | jq .
   curl -H "Authorization: Bearer $HERMES_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"task_id":"abc-123","approver":"alice"}' \
        https://hermes.daveai.tech/zeroclaw/approve
   ```

3. IDE test: open ZeroClaw tab → live panel shows pending items. Set the
   "Approve as" name (defaults to `kilo-user`), then click Approve/Reject
   on any item. The queue auto-refreshes after each action.

4. Unit tests:
   ```bash
   pnpm --filter @kilocode/vscode test src/kilo-provider/handlers/__tests__/zeroclaw-webview.test.ts
   ```

## Mock server

```js
const mockQueue = [
  {
    task_id: "abc-123", description: "Run schema migration on prod-replica-2",
    risk_level: "high", project_path: "/srv/app",
    requested_by: "researcher-agent", requested_at: Date.now(),
    diff_preview: "+ ALTER TABLE users ADD COLUMN ...",
    network_policy: "deny", write_policy: "approved",
  },
];
app.get("/zeroclaw/queue", (_, res) => res.json({ queue: mockQueue }));
app.post("/zeroclaw/approve", (req, res) => res.json({
  ok: true, task_id: req.body.task_id, status: "approved"
}));
app.post("/zeroclaw/reject", (req, res) => res.json({
  ok: true, task_id: req.body.task_id, status: "rejected"
}));
```

## Known limitations / TODO

- The `/zeroclaw/queue` endpoint is part of the ZeroClaw service shipped in
  commit e9c9bf5. If the service is down, the panel shows "No tasks
  awaiting approval" with the error in the corner — verify with
  `curl /zeroclaw/queue` if you suspect the queue is silently dropping items.
- Approval audit (who approved what when) is the responsibility of the
  Hub-side ZeroClaw service. The handler just posts the approver name; it's
  on the service to ledger it.
- Task IDs are accepted in both `task_id` (HTTP-native, snake_case) and
  `taskId` (TypeScript-native, camelCase) so both the new live panel and
  any legacy UI code paths work without changes.
