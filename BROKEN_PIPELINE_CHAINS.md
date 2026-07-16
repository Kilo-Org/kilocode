# Broken Kilo Pipeline Chains: PR #12204, Fourth Pass

Audited PR HEAD `627be20ed6ceb589316df9b54a2ae398146fd684` against actual merge base `e084ab7492eb6f330768157663b29c347dc0fa18`.

## Findings

### High: effective references remain provisional for non-reference consumers

Effective Kilo reconciliation is invoked only by `/api/reference`. Other consumers wait for Core plugin boot and read the provisional filesystem-scanned `Reference.Service` directly:

- Agent external-directory permissions
- Stable system prompt references
- V2 reference guidance
- Core named-reference Glob and Grep tools

A CLI or API flow that reaches these consumers before, or without, `/api/reference` misses account, managed, and `KILO_CONFIG_CONTENT` references. Agent permissions derived from provisional state can remain cached after later reconciliation.

Move reconciliation to a location initialization barrier and require every effective-reference consumer to await it. Test first-use Agent permissions, system prompts, guidance, and tools using effective-only configuration.

### Medium: reference listing has an unconditional mutation/event feedback edge

Every `/api/reference` request reconciles and unconditionally calls `Reference.replace()`, even when sources are unchanged. Replacement always rebuilds state, may restart Git refreshes, and publishes `reference.updated`. The TUI responds to that event by requesting `/api/reference` again.

The source-level feedback cycle is confirmed. In normal TUI startup it may terminate once project filtering rejects project-less endpoint events, so an indefinitely sustained loop is not guaranteed; before project resolution or for consumers without that filter, repeated requests/events remain possible.

Make equal replacements no-op, suppress reconciliation-originated updates, or remove event-driven refetch. Add repeated-GET and event-refetch tests.

## Resolved Since Third Pass

- Legacy CLI and HTTP logout now remove matching Core credentials before deleting legacy auth, with focused coverage.
- `description` and `hidden` survive reconciliation.
- Session-switcher and V2 debug experimental plugin chains are restored with registry coverage.
- Previous OAuth, TUI rendering, package-test, and MCP profile findings remain resolved.

All exact-head required checks pass. This was a read-only source audit; the findings were independently traced but not reproduced in a live TUI.
