# Routing Webview Handler — Live Wiring

## What it does

The RoutingTab gets a real model registry and a real route-decision endpoint
by calling the LiteLLM proxy on the Hub. Two operations:

1. **List models** — surfaces the live LiteLLM model catalog (id, provider,
   context window, $/1k tokens, capabilities, health). The IDE no longer
   needs to hard-code a five-row provider list — whatever LiteLLM is
   configured to expose, the UI shows.
2. **Route a task** — sends a task description (and optional preferred
   model). LiteLLM applies its routing config (cost/quality/availability)
   and returns the chosen model + reason + fallback chain.

This complements (does NOT replace) the existing in-process `RoutingService`,
which still owns the per-key SecretStorage, role matrix, and circuit
breakers. The Hub-side LiteLLM is the source of truth for **what models
exist** and **which one to actually use right now**.

## Wire diagram

```
RoutingTab.tsx
   │
   │  vscode.postMessage({ type: "routing.listModels" })
   │  vscode.postMessage({ type: "routing.route", task, model? })
   ▼
KiloProvider → __daveExtensions.handleV4Message
   │  routing.* prefix → handleRoutingRealWebviewMessage
   ▼
routing-webview.ts
   │  fetch(`${HUB_BASE}/api/litellm/models`)
   │  fetch(`${HUB_BASE}/api/litellm/route`, POST { task, model? })
   ▼
LiteLLM proxy (https://hermes.daveai.tech/api/litellm/*)
   │  applies routing rules → selects upstream
   ▼
postMessage({ type: "routing.update", payload: { kind, ... } })
   ▼
RoutingTab.tsx live panel re-renders
```

## How to test locally

1. Set hub base + key as for Hermes (shared bearer).
2. Curl smoke test:
   ```bash
   curl -H "Authorization: Bearer $HERMES_API_KEY" \
        https://hermes.daveai.tech/api/litellm/models | jq '.data[].id'
   ```
3. IDE test: open Routing tab → "LiteLLM Routing (Live Hub)" panel shows the
   model list. Drop a task in the input and click **Route** → response shows
   the selected model + reason.
4. Unit tests:
   ```bash
   pnpm --filter @kilocode/vscode test src/kilo-provider/handlers/__tests__/routing-webview.test.ts
   ```

## Mock server

```js
app.get("/api/litellm/models", (_, res) => res.json({
  data: [
    { id: "claude-3-5-sonnet", provider: "anthropic", context_window: 200000,
      cost_per_1k_input: 0.003, cost_per_1k_output: 0.015, status: "healthy" },
    { id: "gpt-4o", provider: "openai", context_window: 128000,
      cost_per_1k_input: 0.005, cost_per_1k_output: 0.015, status: "healthy" },
  ],
}));
app.post("/api/litellm/route", (req, res) => res.json({
  selected: req.body.model ?? "claude-3-5-sonnet",
  reason: "Best cost/quality fit for this task class",
  fallback: ["gpt-4o", "minimax-text-01"],
  estimated_cost_usd: 0.05,
}));
```

## Known limitations / TODO

- LiteLLM's `/route` endpoint is a custom Hub-side wrapper, not native to
  LiteLLM. Confirm `src/webui/hub/routers/litellm_proxy.py` exposes it; if
  not, this handler will receive 404 and surface it in `payload.error`.
- The handler accepts `data` OR `models` shape so both LiteLLM-native and
  Hub-wrapped responses work without changes.
- Provider health (`status` field) is a Hub-side enrichment. If LiteLLM
  doesn't report it, the UI falls back to "no health badge" — not an error.
