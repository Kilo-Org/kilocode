# Memory Webview Handler — Live Wiring

## What it does

The MemoryTab now reads/queries the Shiba Memory service running behind the
Hub. Two operations:

1. **List memories** — pulls the current memory inventory so the UI shows
   what's actually indexed (count + summaries).
2. **Recall** — semantic search against the Shiba index. The user types a
   natural-language query, and Shiba returns the top-K matching entries with
   relevance scores and match-reason explanations.

The legacy `memoryGetStatus` / `memoryRecall` channel still works (it
dispatches to the in-process `MemoryService`). This handler adds a new path
that goes to the **remote** Shiba service — the source of truth across all
Kilo workstations.

## Wire diagram

```
MemoryTab.tsx
   │
   │  vscode.postMessage({ type: "memory.list" })
   │  vscode.postMessage({ type: "memory.recall", query })
   ▼
KiloProvider → __daveExtensions.handleV4Message
   │  memory.* prefix → handleMemoryRealWebviewMessage
   ▼
memory-webview.ts
   │  fetch(`${HUB_BASE}/api/shiba/memories`)
   │  fetch(`${HUB_BASE}/api/shiba/recall`, POST { query, project })
   ▼
Shiba Memory service (https://hermes.daveai.tech/api/shiba/*)
   │  vector search → top-K + relevance
   ▼
postMessage({ type: "memory.update", payload: { kind, ... } })
   ▼
MemoryTab.tsx live panel re-renders
```

## How to test locally

1. Configure base + key (same `kilo-code.new.hermes.apiKey` SecretStorage
   slot — Hermes/Shiba share the Hub bearer):
   ```bash
   export KILO_HUB_BASE="https://hermes.daveai.tech"
   ```

2. Direct curl test:
   ```bash
   curl -H "Authorization: Bearer $HERMES_API_KEY" \
        https://hermes.daveai.tech/api/shiba/memories | jq .
   ```

3. From the IDE: open the Memory tab → live panel auto-loads. Type a query
   in the search box → results appear with relevance bars.

4. Run unit tests:
   ```bash
   pnpm --filter @kilocode/vscode test src/kilo-provider/handlers/__tests__/memory-webview.test.ts
   ```

## Mock server

```js
app.get("/api/shiba/memories", (_, res) => res.json({
  memories: [{ id: "m1", project: "kilo", scope: "project", factType: "fix",
    summary: "Don't await inside loops", content: "...", traceRef: "task-7", timestamp: 1700000000 }],
  entryCount: 1,
}));
app.post("/api/shiba/recall", (req, res) => res.json({
  query: req.body.query, project: req.body.project, status: "success",
  results: [{ ...mockMemory, relevanceScore: 0.92, matchReason: "exact term match" }],
  timestamp: Date.now(),
}));
```

## Known limitations / TODO

- The handler assumes the Hub gateway forwards `/api/shiba/*` to the Shiba
  upstream. If you see HTTP 502 from the live panel, the proxy entry on the
  Hub side is missing — check `src/webui/hub/main.py` mounts the Shiba router.
- `memory.write` is intentionally NOT in this handler. Writes are still
  driven by the agents themselves through the legacy MemoryService — manual
  writes from the IDE go through the existing `memoryWrite` message.
