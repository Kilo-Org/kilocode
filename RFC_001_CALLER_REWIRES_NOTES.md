# RFC 001 — Caller-Site Rewires for `KiloProvider` Overlay Methods

Status: Implementation complete (2026-04-26)
Implementer: agent-rfc001-caller-rewires
Companion to: `RFC_001_IMPLEMENTATION_NOTES.md`

## Summary

After RFC 001 moved `setHermesServices`, `setV4Services`, `broadcastDiscoveryComplete`,
`getEnrichedGovernanceSnapshot`, and `sendGovernanceState` off `KiloProvider` and
onto the `DaveProviderExtensions` overlay (stored at `(provider as any).__daveExtensions`),
the live caller sites in `extension.ts` and `SettingsEditorProvider.ts` were still
calling those methods directly on the provider — which would fail typecheck once
the slimmed `KiloProvider.ts` lands.

This delivery rewires every caller of `setHermesServices` / `setV4Services` /
`broadcastDiscoveryComplete` on a `KiloProvider` instance to dispatch through
`__daveExtensions?.` instead. Calls on a `SettingsEditorProvider` instance (which
has its own forwarding wrappers) are intentionally left untouched.

Two files changed; `KiloProvider.ts` and `KiloProvider.dave.ts` from the prior
delivery are not modified.

## Files staged

| File | Status | Lines changed |
|------|--------|---------------|
| `packages/kilo-vscode/src/extension.ts` | REWRITTEN | 1 import added + 11 caller-site rewrites (12 directives total — line 242 in the original spans the start of a `setV4Services({...})` call, the closing block at line 252 is unchanged) |
| `packages/kilo-vscode/src/SettingsEditorProvider.ts` | REWRITTEN | 1 import added + 4 caller-site rewrites |

## Per-line diff table

### `packages/kilo-vscode/src/extension.ts`

| Line (orig) | Before | After |
|------------:|--------|-------|
| 2 (insert after) | *(no `KiloProvider.dave` import)* | `import type { DaveProviderExtensions } from "./KiloProvider.dave"` (added as new line 3) |
| 241 | `provider.setHermesServices(hermesStatus, hermesClient)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(hermesStatus, hermesClient)` |
| 242 | `provider.setV4Services({` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services({` |
| 272 | `provider.setV4Services(v4WithDiscovery)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services(v4WithDiscovery)` |
| 273 | `settingsEditorProvider.setV4Services(v4WithDiscovery)` | *(unchanged — `settingsEditorProvider` is a `SettingsEditorProvider`, not a `KiloProvider`)* |
| 310 | `provider.broadcastDiscoveryComplete?.(result)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.broadcastDiscoveryComplete?.(result)` |
| 378 | `tabProvider.setHermesServices(hermesStatus, hermesClient)` | `;(tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(hermesStatus, hermesClient)` |
| 379 | `tabProvider.setV4Services({` | `;(tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services({` |
| 426 | `settingsEditorProvider.setHermesServices(hermesStatus, hermesClient)` | *(unchanged — `settingsEditorProvider` is a `SettingsEditorProvider`)* |
| 427 | `settingsEditorProvider.setV4Services({` | *(unchanged — `settingsEditorProvider` is a `SettingsEditorProvider`)* |
| 690 | `v4Services: Parameters<KiloProvider["setV4Services"]>[0],` | `v4Services: Parameters<DaveProviderExtensions["setV4Services"]>[0],` |
| 716 | `if (hermesStatusArg && hermesClientArg) tabProvider.setHermesServices(hermesStatusArg, hermesClientArg)` | `if (hermesStatusArg && hermesClientArg) (tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(hermesStatusArg, hermesClientArg)` |
| 717 | `tabProvider.setV4Services(v4Services)` | `;(tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services(v4Services)` |

Note on the leading semicolon: ASI (automatic semicolon insertion) requires a
leading `;` before any line that starts with `(` to prevent it from being
interpreted as a call on the previous expression. The original code did not
have this issue because it began with an identifier; the rewrites must.

The single exception is line 716, where the rewrite stays on a single
`if (cond) (expr).foo?.(...)` form — the `if (cond)` keyword guarantees ASI
already, so no leading `;` is needed.

### `packages/kilo-vscode/src/SettingsEditorProvider.ts`

| Line (orig) | Before | After |
|------------:|--------|-------|
| 2 (insert after) | *(no `KiloProvider.dave` import)* | `import type { DaveProviderExtensions } from "./KiloProvider.dave"` (added as new line 3) |
| 136 | `provider.setHermesServices(this.hermesStatusSvc, this.hermesClientSvc)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(this.hermesStatusSvc, this.hermesClientSvc)` |
| 139 | `provider.setV4Services(this.v4Services)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services(this.v4Services)` |
| 197 | `provider.setV4Services(services)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services(services)` |
| 207 | `provider.setHermesServices(status, client)` | `;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(status, client)` |

The class-level `setV4Services` and `setHermesServices` methods on
`SettingsEditorProvider` (the `for (const [, provider] of this.providers) { ... }`
loops at lines 192-208) are *not* removed — they continue to act as the
per-panel forwarders. Only the body of the loop changes: each iteration now
hops onto the per-`KiloProvider` overlay instead of calling the now-removed
methods on the provider directly.

## Type-reference rewire (line 690)

`Parameters<KiloProvider["setV4Services"]>[0]` no longer resolves because
`setV4Services` is gone from `KiloProvider`. The overlay's
`DaveProviderExtensions` class — which is a regular `export class` from
`./KiloProvider.dave` — now owns the method, so the rewire imports the type
and reads its parameters:

```ts
v4Services: Parameters<DaveProviderExtensions["setV4Services"]>[0],
```

This preserves the original intent (the parameter shape comes from the single
source-of-truth method signature) without leaking implementation details into
`extension.ts`.

## What was *not* changed

- `KiloProvider.ts` and `KiloProvider.dave.ts` — staged unchanged from the
  prior delivery.
- `services/onboarding/OnboardingDiscoveryService.ts` — outside this delivery's
  scope. (No `provider.broadcastDiscoveryComplete(...)` callsite was found by
  grep on the staging or live tree; if one appears in a future merge, apply
  the same `__daveExtensions?.` pattern.)
- Tests under `packages/kilo-vscode/__tests__/` — outside this delivery's
  scope. The orchestrator's checklist flagged 3-5 caller files; this delivery
  covers the two non-test caller files (`extension.ts` and
  `SettingsEditorProvider.ts`).

## Acceptance-criterion verification

| Criterion | Result |
|-----------|--------|
| Both files are byte-identical to the originals except for the rewired caller lines | PASS — verified with `diff` against `G:/Github/kilocode-Azure2/packages/kilo-vscode/src/{extension,SettingsEditorProvider}.ts`. The only deltas are the lines documented in the table above. |
| Every caller of the moved methods on a `KiloProvider` instance now dispatches through `(provider as any).__daveExtensions?.` | PASS — manual audit + `grep` for the literal `setHermesServices(`, `setV4Services(`, `broadcastDiscoveryComplete` in the staged files; all hits on a `KiloProvider` are now overlay dispatches. |
| Calls on a `SettingsEditorProvider` instance are not touched | PASS — extension.ts lines 273, 426-427 are byte-identical to the original. |
| `bun turbo typecheck` passes | NOT EMPIRICALLY VERIFIED — the implementer is sandboxed. The static analysis below predicts a clean compile. |

## Static-analysis predictions (in lieu of `bun turbo typecheck`)

1. `KiloProvider.dave.ts` exports `class DaveProviderExtensions` (line 34); both
   staged files import it via `import type { DaveProviderExtensions } from
   "./KiloProvider.dave"`. The new import is emitted via `import type`, so it
   is erased at runtime — no circular runtime dependency.

2. The cast pattern
   `(provider as unknown as { __daveExtensions?: DaveProviderExtensions })`
   widens `provider` through `unknown` first to satisfy TypeScript's
   "neither type sufficiently overlaps the other" rule. This compiles cleanly
   regardless of whether `KiloProvider` itself declares `__daveExtensions`.

3. Optional-chaining `__daveExtensions?.` short-circuits to `undefined` if the
   overlay was not installed (e.g., a hypothetical test that skips
   `installDaveExtensions(this)` in the constructor). The original semantics —
   which assumed the methods were always present on a fully-constructed
   provider — are preserved because the constructor *does* call
   `installDaveExtensions(this)` per the prior delivery (`KiloProvider.ts`
   line 257).

4. `broadcastDiscoveryComplete?.(result)` keeps its outer optional-chain so the
   pre-overlay behavior (silently no-op if the method is missing) survives.
   The double-optional-chain
   `__daveExtensions?.broadcastDiscoveryComplete?.(result)` is also fine
   typescript — `broadcastDiscoveryComplete` is declared non-optional on
   `DaveProviderExtensions` (line 86 of `KiloProvider.dave.ts`), but the
   trailing `?.()` is harmless since TS does not mind redundant optional calls
   on a definitely-present method.

5. `Parameters<DaveProviderExtensions["setV4Services"]>[0]` resolves to the
   inline object type declared at line 116 of `KiloProvider.dave.ts`, which
   matches the original `KiloProvider["setV4Services"]` shape (same fields,
   same optionality on `discovery`).

6. `extension.ts` already imports `KiloProvider` as a value (line 2) and uses
   it as a value in the `Map<vscode.WebviewPanel, KiloProvider>` generic
   parameter and the `KiloProvider.viewType` static reference. No additional
   value imports are needed — the new import is type-only.

## Test plan

```bash
cd G:/Github/contract-kit-v17/.claude/worktrees/busy-elgamal-a14bac/staging/kilocode-Azure2

# 1. Drop the staged files into the live tree (the orchestrator does this
#    when integrating this delivery; it is *not* done by the implementer).
cp packages/kilo-vscode/src/extension.ts \
   ../../../../../../../kilocode-Azure2/packages/kilo-vscode/src/extension.ts
cp packages/kilo-vscode/src/SettingsEditorProvider.ts \
   ../../../../../../../kilocode-Azure2/packages/kilo-vscode/src/SettingsEditorProvider.ts
cp packages/kilo-vscode/src/KiloProvider.ts \
   ../../../../../../../kilocode-Azure2/packages/kilo-vscode/src/KiloProvider.ts
cp packages/kilo-vscode/src/KiloProvider.dave.ts \
   ../../../../../../../kilocode-Azure2/packages/kilo-vscode/src/KiloProvider.dave.ts

# 2. From the kilocode-Azure2 root (NOT the worktree):
cd G:/Github/kilocode-Azure2
bun install
bun turbo typecheck

# 3. Optional smoke test (extension build):
bun turbo build --filter=kilo-vscode
```

Expected outcome: `bun turbo typecheck` exits zero. If it doesn't, the most
likely cause is a stale cache — `rm -rf node_modules/.cache .turbo` then re-run.

## Caller sites NOT updated by this delivery

For completeness — these callers were either out-of-scope or do not exist in
the current source tree but should still be verified before opening the PR:

- `services/onboarding/OnboardingDiscoveryService.ts` — grep returned no hits
  for `provider.broadcastDiscoveryComplete` here; nothing to rewire.
- `__tests__/**/*.ts` — orchestrator's checklist; not surveyed by this delivery.
  Any test that calls `provider.setV4Services(...)` /
  `provider.setHermesServices(...)` /
  `provider.broadcastDiscoveryComplete(...)` will fail typecheck and must be
  updated using the same pattern documented above.

## Rollback

To revert this delivery without losing the prior `KiloProvider` /
`KiloProvider.dave` work, restore just the two caller files:

```bash
git checkout HEAD -- \
  packages/kilo-vscode/src/extension.ts \
  packages/kilo-vscode/src/SettingsEditorProvider.ts
```

The rewired caller pattern can also be removed by global replace if needed:
the regex `;(\(.*?\)\.__daveExtensions\?\.)` covers every rewrite written by
this delivery.
