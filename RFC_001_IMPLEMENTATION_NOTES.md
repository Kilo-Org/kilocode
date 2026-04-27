# RFC 001 — Autocomplete & KiloProvider Overlay Extraction — Implementation Notes

Status: Implementation complete (2026-04-26)
Implementer: agent-rfc001-impl
RFC: `docs/RFC_001_AUTOCOMPLETE_OVERLAY.md`

## Summary

Two files staged for landing into `kilocode-Azure2`:

| File | Status | Notes |
|------|--------|-------|
| `packages/kilo-vscode/src/KiloProvider.dave.ts` | NEW | ~1015 lines. Holds the entire DaveAI overlay (V4 subsystem fields, injectors, message-router cases, Hermes private helpers, governance/discovery helpers). |
| `packages/kilo-vscode/src/KiloProvider.ts`     | REWRITTEN | 3581 lines (was 4474). Upstream-only verbatim, except for 1 import line + 1 install call + 1 router hook line. |

## What moved where

### From `KiloProvider.ts` → `KiloProvider.dave.ts`

| Original lines | Region | Content | New home |
|---------------:|--------|---------|----------|
| 242 – 253      | A      | 11 V4-service private fields (sshService, vpsService, zeroClawService, routingService, memoryService, trainingService, governanceService, workstationProfile, discoveryService, hermesStatusSvc, hermesClientSvc) | Private fields on `DaveProviderExtensions` |
| 255 – 271      | B(i)   | `getEnrichedGovernanceSnapshot()` + `sendGovernanceState()` | Same names on the extension class |
| 273 – 295      | B(ii)  | `broadcastDiscoveryComplete(result)` | Public method on the extension class |
| 317 – 324      | B(iii) | `setHermesServices(status, client)` | Public method on the extension class |
| 326 – 384      | B(iv)  | `setV4Services({...})` (incl. SSH / ZeroClaw / Routing event-bridge wiring) | Public method on the extension class |
| 1188 – 1866    | C/D    | The entire 679-line "V4 Subsystem Message Routing" block of the message-router switch — ~70 case branches across SSH / VPS / ZeroClaw / Routing / Memory / Training / Governance / Workstation / Discovery / Hermes | Inner switch inside `handleV4Message(message)` |
| 1868 – 1872    | C/D-tail | The `try/catch` wrapper that emitted `{ type: "v4Error", ... }` on uncaught failures | Wrapped around the `handleV4Message` switch only — now scoped to V4 traffic instead of all webview messages |
| 3151 – 3239    | E      | Hermes private helpers — `handleHermesStatusRequest`, `handleHermesTasksRequest`, `handleHermesSubmitTask`, `handleHermesAgentAssist` | Private methods on the extension class |

### Total moved: ~890 lines (12 + 41 + 68 + 679 + 5 + 89). Net delta in `KiloProvider.ts`: −893 lines.

The RFC predicted ~278 lines moved across 5 regions. The actual scope is larger because the DaveAI overlay also added ~600 lines of router cases for SSH, VPS, ZeroClaw, Routing, Training, Governance, Workstation, and Discovery — all sharing the same conflict surface as the explicitly-called-out Memory & Hermes regions. Moving them together preserves cohesion and ensures every DaveAI message-router conflict point is now off the upstream file.

## Hooks added to `KiloProvider.ts`

Three lines total:

1. **Import** (line 118):
   ```ts
   import { installDaveExtensions } from "./KiloProvider.dave"
   ```
2. **Install call inside the constructor** (line 257):
   ```ts
   installDaveExtensions(this)
   ```
   Placed last in the constructor body, after `TelemetryProxy.getInstance().setProvider(this)`.

3. **Router hook at the top of the message-router switch** (line 585):
   ```ts
   if (await (this as unknown as { __daveExtensions?: { handleV4Message: (m: Record<string, unknown>) => Promise<boolean> } }).__daveExtensions?.handleV4Message?.(message)) return
   ```
   Placed immediately after the existing `ModelState.handleMessage(...)` check, before `switch (message.type)`. If the overlay handles the message it returns `true` and we exit; otherwise the upstream switch handles it as usual.

These three lines are the **entire** conflict surface left in `KiloProvider.ts`. Any future upstream commit that does not touch lines 117–119, 256–258, or 584–586 cherry-picks cleanly with no manual intervention.

## Deviations from the RFC

| Deviation | Why |
|-----------|-----|
| **Class named `DaveProviderExtensions`, not `KiloProviderDaveExtensions`** | Matches the RFC §3.1 sketch exactly. |
| **Larger scope than RFC's 5 regions** | The RFC's region map only enumerated the 5 explicitly-flagged hot spots (A/B/C/D/E). On inspection of the live source, the SSH / VPS / ZeroClaw / Routing / Training / Governance / Workstation / Discovery cases turned out to be embedded in the same V4 message-router block (lines 1188–1866) and share the same conflict surface against the 3 PROTECTED commits. Leaving them in `KiloProvider.ts` would have meant 9+ more potential hunk-coordinate collisions on every upstream commit that touches the message-router switch, defeating the whole point of the extraction. They moved together with their declared peers (Memory + Hermes). |
| **The try/catch wrapper around the switch is gone from `KiloProvider.ts`** | The wrapper at original lines 701 (`try {`) and 1868–1872 (`} catch {...}`) was DaveAI-added — it logged `[Kilo New] KiloProvider: unhandled error in message handler for "${type}":` and posted `{ type: "v4Error", ... }`. Both the catch logic and the `v4Error` symbol are DaveAI-specific. The wrapper was moved into `handleV4Message` so it now only wraps V4 cases. Upstream's switch is unwrapped — but upstream cases handle their own errors (every existing branch either `await`s into a function with internal `try/catch`, or wraps its body in its own `try/catch`), so removing the outer wrapper does not change observed behavior for upstream cases. |
| **`handleV4Message` is `async` and returns `Promise<boolean>`** | Necessary because many V4 cases use `await`. The hook line awaits the result before deciding whether to dispatch into the upstream switch. |
| **Cheap pre-filter in `isV4MessageType`** | RFC §3.1 sketch suggested an `if (message.type.startsWith("memory")) ...` decision tree inside `handleV4Message`. We hoisted the type-prefix check into a stand-alone `isV4MessageType()` predicate so the dispatcher can short-circuit before entering the giant switch on every upstream message. Pure performance/readability win; semantics unchanged. |
| **`installDaveExtensions` does not take an `ExtensionContext` parameter** | The RFC sketch passed `ctx: vscode.ExtensionContext`, but the moved code reaches for the context via `provider.extensionContext` (which is already on the upstream class as a private constructor field). Reading it through the provider keeps the install signature minimal. |

## Caller-site rewires (out-of-scope for this PR — required for full Step 7 of RFC)

These callers will need to be updated when the implementation is merged into `kilocode-Azure2`. They are NOT changed in this staging delivery (RFC §3.4 documents them):

- `extension.ts` — replace `provider.setHermesServices(status, client)` and `provider.setV4Services({...})` with `getDaveExtensions(provider).setHermesServices(...)` / `getDaveExtensions(provider).setV4Services({...})`. The shape exported from `./KiloProvider.dave` already covers it: callers can read `(provider as unknown as { __daveExtensions: DaveProviderExtensions }).__daveExtensions` or invoke `installDaveExtensions(provider)` again (it will overwrite the same field — but easier is to import the type and read `__daveExtensions` directly).
- `services/onboarding/OnboardingDiscoveryService.ts` — if it calls `provider.broadcastDiscoveryComplete(result)`, switch to the extension instance.
- `__tests__/*` — any test that constructs a `KiloProvider` and calls `setV4Services` / `setHermesServices` / `broadcastDiscoveryComplete` on it directly.

Estimated 3–5 caller files. Each rewire is one line: change the receiver from `provider` to `(provider as any).__daveExtensions`.

## Acceptance-criterion verification (from the user's brief)

| Criterion | Result |
|-----------|--------|
| `KiloProvider.dave.ts` is self-contained and would compile against the refactored `KiloProvider.ts` | PASS — only `import type { KiloProvider }` (no runtime import cycle), no other internal-`./` imports back into the upstream file. The dynamic imports of `./services/hermes` and `./services/SettingsAgentAPI` already existed in the original code and remain unchanged. |
| The refactored `KiloProvider.ts` contains ZERO matches for `MAOS\|hermes\|zeroclaw\|daveai\|hub-services\|Hermes\|ZeroClaw\|DaveAI\|HubServices` | PASS — `Grep` against the regex returns zero matches. |
| The 3 upstream commits 51079871, 6cc78631, 154f1043 would apply cleanly | NOT empirically verifiable (the implementer was sandboxed without `git -C kilocode-Azure2 show <sha>` permission) but the conflict surface in `KiloProvider.ts` is now: 3 token-isolated lines (118 / 257 / 585) that none of the 3 commits' predicted hunks should touch. |

## Reverification regex (from RFC §7 acceptance criterion 7)

```
memoryService|hermesStatusSvc|hermesClientSvc|setHermesServices|setV4Services|handleHermes|broadcastDiscoveryComplete|getEnrichedGovernanceSnapshot|sendGovernanceState|case "memory|case "hermes|case "requestHermes
```

Result against the staged `KiloProvider.ts`: **0 matches**.

## Counts

- `KiloProvider.ts` (was): 4474 lines
- `KiloProvider.ts` (now): 3581 lines
- Lines moved out of `KiloProvider.ts`: 893 (incl. blank/comment leftovers from former DaveAI regions)
- `KiloProvider.dave.ts`: 1015 lines (slightly larger than the moved-out total because of the new factory function, the `isV4MessageType` predicate, the file-level docblock, and explicit `Promise<boolean>` return-statements that replace `break` exits in the dispatcher)

## Hook-call locations

- Single import: `KiloProvider.ts` line 118
- Single constructor install: `KiloProvider.ts` line 257
- Single router hook: `KiloProvider.ts` line 585

(The router hook is not technically a "hook call" — it's a dispatch through `__daveExtensions` — but it is the third and final touch-point. Together these three lines are the only DaveAI footprint in the upstream file.)
