# Hermes Webview Handler — Live Wiring

## What it does

The HermesTab now talks directly to the Hermes Router behind the Hub.
Two operations:

1. **List agents** — surfaces every agent the Hermes Router knows about
   (researcher, auditor, executor, etc.) so the UI can show what's available
   and let the user route to a specific one.
2. **Route a task** — sends a free-text task description (and optionally a
   specific agent ID) to `/hermes/route`. The router decides which agent to
   use and returns the agent's output plus a cost estimate.

This is the path that turns "Hermes" from a connection-status widget into a
working agent dispatcher.

## Wire diagram

```
HermesTab.tsx (SolidJS, webview-ui)
   │
   │  vscode.postMessage({ type: "hermes.listAgents" })
   │  vscode.postMessage({ type: "hermes.route", task, agent? })
   ▼
KiloProvider message router
   │  delegates to __daveExtensions
   ▼
DaveProviderExtensions.handleV4Message  (hermes.* prefix)
   │
   │  calls handleHermesRealWebviewMessage(msg, ctx)
   ▼
hermes-webview.ts
   │  fetch(`${HUB_BASE}/hermes/agents`,  { headers: Authorization: Bearer ... })
   │  fetch(`${HUB_BASE}/hermes/route`,   { method: POST, body: { task, agent? } })
   ▼
Hermes Router (https://hermes.daveai.tech/hermes/*)
   │  resolves agent → MiniMax / Claude / etc
   ▼
Response flows back the same path:
   handler → postMessage({ type: "hermes.update", payload: { kind, ... } })
   ▼
HermesTab.tsx subscribes to "hermes.update" and re-renders
```

## How to test locally

1. Set the Hub base in your shell before launching VS Code:
   ```bash
   export KILO_HUB_BASE="https://hermes.daveai.tech"   # production
   # or for staging / mock:
   export KILO_HUB_BASE="http://localhost:8091"
   ```

2. Store a Hermes API key:
   - Open Settings → Hermes tab
   - Paste key into the API Key field, click **Store**
   - This persists to VS Code SecretStorage under `kilo-code.new.hermes.apiKey`

3. Smoke test from a Node REPL:
   ```js
   const r = await fetch("https://hermes.daveai.tech/hermes/agents", {
     headers: { Authorization: "Bearer YOUR_KEY" },
   });
   console.log(await r.json());
   // → { agents: [{ id: "researcher", name: "Researcher", ... }, ...] }
   ```

4. From the running extension:
   - Open the Hermes tab → the **Live Hub** panel auto-loads agents.
   - Type a task ("audit /etc/nginx for misconfigured TLS") and click **Route**.
   - Response appears in the panel within ~2-5s.

5. Run unit tests:
   ```bash
   pnpm --filter @kilocode/vscode test src/kilo-provider/handlers/__tests__/hermes-webview.test.ts
   ```

## Mock server (for CI / offline dev)

```js
// scripts/mock-hub.js
import express from "express";
const app = express();
app.use(express.json());
app.get("/hermes/agents", (_, res) => res.json({
  agents: [{ id: "researcher", name: "Researcher", description: "Reads docs and summarizes" }],
}));
app.post("/hermes/route", (req, res) => res.json({
  agent: req.body.agent ?? "researcher",
  output: `Mock response for: ${req.body.task}`,
  cost_usd: 0.001,
}));
app.listen(8091);
```

Run with `node scripts/mock-hub.js` and set `KILO_HUB_BASE=http://localhost:8091`.

## Known limitations

- The Hermes Router currently routes synchronously. For long-running tasks
  (>60s) you'll get a fetch timeout. A streaming/SSE variant is on the
  Hermes Router roadmap (`/hermes/route/stream`).
- Agent capabilities are not yet propagated through to the UI — the router
  doesn't expose them on `/hermes/agents` yet. When it does, the `agents`
  payload will gain a `capabilities: string[]` field automatically.
