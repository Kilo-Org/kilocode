---
title: "Per-Message Feedback"
description: "Thumbs up/down feedback on assistant messages sent to Kilo via telemetry"
---

# Per-Message Feedback (Thumbs Up / Down)

## Problem

We have no signal on which assistant responses are helpful and which aren't. Without per-response feedback, we can't:

- Correlate model or prompt changes to user-perceived quality
- Identify specific bad responses in the Kilo Gateway logs for investigation
- Detect patterns where certain providers, models, or prompt paths consistently underperform

Aggregate metrics like session completion rate or token cost are too coarse to understand individual response quality. A lightweight thumbs-up/down on each message can help close the feedback loop.

## Proposal

Add a thumbs-up / thumbs-down widget next to the existing copy button on every assistant message. Ratings are sent to Kilo via the existing PostHog telemetry pipeline. The UI is hidden entirely when telemetry is disabled.

### Scope

| Surface | Approach |
|---|---|
| VS Code extension | Thumbs buttons inline next to the copy button |
| TUI | Keybinds (`<leader>+` / `<leader>-`) on the last assistant message |

### Telemetry Payload

We deliberately collect fewer identifiers for non-Kilo providers, since those IDs can't be correlated to upstream data and add tracking surface without product benefit. Users of non-Kilo GW models would also not expect or want us to collect that information in Kilo GW from other providers.

**Third party providers (Anthropic, OpenAI, local, etc.):**
`providerID`, `modelID`, `variant?`, `rating`, `previousRating?`

**Kilo Gateway turns (`providerID` starts with `"kilo"`):**
Same fields plus `sessionID`, `messageID`, and `parentMessageID` (= the `x-kilo-request` header the gateway already saw). This lets backend analysts join feedback against gateway logs to diagnose specific bad responses.

Event name: `"Feedback Submitted"` — a single event string in both telemetry enum registries so PostHog sees one event regardless of source.

### UX

- **Toggleable**: click the same button again to clear, or click the opposite to switch. Each change fires a new event with `rating` and `previousRating`.
- **In-memory state**: ratings are keyed by message ID and held in the webview/TUI session. Persisting across reloads is deferred to a follow-up.
- **Gated on telemetry**: if the user has VS Code telemetry disabled, the buttons don't render at all. For the CLI when telemetry is off, the keybinds are no-ops.

### Architecture (high level)

```
[webview button / TUI keybind]
  → existing telemetry proxy or Telemetry.track()
  → POST /telemetry/capture  (webview path)
  → Telemetry.track("Feedback Submitted", {…})
  → PostHog
```

No new server endpoints, no SDK regeneration, no PostHog-side changes. The `/telemetry/capture` route and both telemetry proxy paths already exist and accept arbitrary event names.

### Kilo Gateway Detection

The webview uses `providerID.startsWith("kilo")` to decide whether to include correlation IDs — this matches the outbound header gating in `packages/opencode/src/session/llm.ts`. The TUI can use the more precise `model.api.npm === "@kilocode/kilo-gateway"` check since it has access to the full provider resolution in-process.

## What's Out of Scope

- Free-text comments on thumbs-down
- 1–5 scale or star rating
- Persisting ratings across page reloads / session switches
- Changing prior-message actions (copy + thumbs) to hover-only
- Shared web UI / desktop surface

## Open Questions

- Should ratings persist on the `MessageV2.Assistant` schema so they survive reloads?
- Confirm with the PostHog dashboard owner that the proposed event + property names fit existing conventions.
- Whether to add free-text comments for thumbs-down in a follow-up.
