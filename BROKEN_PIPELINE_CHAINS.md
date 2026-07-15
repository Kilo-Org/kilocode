# Broken Kilo Pipeline Chains: PR #12204, Second Pass

Audited PR HEAD `2d92d8dae2cb2d9efc4961b020dabb11ff5564aa` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Finding

### Medium: OAuth completion can race cancellation or expiry before persistence

`packages/core/src/connector.ts:492-508` marks an OAuth attempt `completing` and awaits the authorization callback without setting `settling`. During that await, cancellation and expiry check only `settling`, so either can remove or expire the attempt.

When the callback returns, `settle()` finds no pending attempt and returns `undefined` before `Credential.create`. `complete()` treats that as success, and `packages/server/src/handlers/connector.ts:79-91` returns HTTP 204 even though no credential was persisted.

The new concurrency test delays `Credential.create`, after settlement already owns the attempt, so it does not cover cancellation while the callback itself is pending.

Atomically claim completion before invoking the callback, reject cancellation and expiry for claimed attempts, and treat missing settlement as failure. Add code- and auto-mode tests that delay the callback and race both cancellation and expiry.

## Owner Decisions

- The `KILO_EXPERIMENTAL_SESSION_SWITCHER` preview feature remains deleted. Confirm this was intentional consolidation onto the standard session dialog; otherwise restore its flag-to-preview chain.
- `KILO_EXPERIMENTAL_EVENT_SYSTEM` still flows into an unused `experimentalEventSystem` TUI registry option. Remove the dead option if the V2 debug route was intentionally retired, or restore the conditional plugin.

## Resolved Since First Pass

- Anonymous Kilo and OpenCode providers no longer mark the TUI connected without authentication or a non-zero-cost model; focused tests cover the predicate.
- Dismissed-question metadata again controls compact expandable presentation.
- Edit metadata again reaches the multi-hunk renderer, with focused splitter tests.
- Running subagents again render `Starting...` before their first tool event.
- TUI prompt arbitration and three-way hydration merging are restored, with focused hydration coverage in source.

## Notable Non-Findings

Kilo TUI plugin ordering, event routing, reactive config, terminal presence/title updates, Kilo tool renderers, isolated credentials, and plan-mode subagent mutation ceilings remain connected.

This was a read-only source audit. The OAuth race was independently traced from connector state through the HTTP handler; no live OAuth flow or interactive TUI was run.
