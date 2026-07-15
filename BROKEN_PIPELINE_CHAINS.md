# Broken Kilo Pipeline Chains: PR #12204, Third Pass

Audited PR HEAD `790affb98f75832a33b680885e4d5fa7586a7290` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Findings

### Medium: legacy provider logout leaves the Core credential active

The new bridge dual-writes Core credential changes into `auth.json`, but legacy removal is not synchronized back:

- `packages/opencode/src/auth/index.ts:84-89` removes only the legacy entry.
- CLI provider logout and the legacy server DELETE route use this path and report success.
- Core credentials remain durable in SQLite and continue feeding `Credential.activeAll()` and the V2 catalog.
- Startup reconciliation imports entries present in `auth.json` but never removes a Core row whose legacy entry disappeared.

A provider can therefore remain authenticated through Core/V2 immediately after successful logout and across restart. Route legacy removal through Core credential removal/deactivation or implement explicit bidirectional deletion ownership. Test CLI and HTTP logout followed by immediate and restarted V2 lookup.

### Medium: effective reference synchronization races and drops metadata

`KiloReference.sync()` is called only during stable Agent initialization. The reference endpoint directly lists Core's provisional state, and TUI agent/reference refreshes start concurrently, so a direct client or startup race can observe provisional references.

The synchronization also reconstructs reference sources without `description` or `hidden`. Hidden aliases can become visible in autocomplete, and described references disappear from model guidance.

Move effective-config reconciliation into reference initialization or the endpoint, await it before listing, and preserve all source metadata. Add direct API and startup-order coverage using effective-only configuration.

## Resolved Since Second Pass

The OAuth completion race is fixed: code completion claims settlement before awaiting the callback, cancellation and expiry cannot remove the claimed attempt, and failures no longer produce a false HTTP 204. A focused cancellation race test covers the original window.

The package-test, README, relative reference root, and profile-aware MCP write fixes also remain connected.

## Owner Decisions

- The experimental session-switcher preview remains deleted; confirm intentional retirement.
- `experimentalEventSystem` still reaches an unused TUI registry option; remove the dead option or restore the debug plugin.

All exact-head required checks pass. This was a read-only source audit; the two findings were independently traced end to end but not reproduced in a live process.
