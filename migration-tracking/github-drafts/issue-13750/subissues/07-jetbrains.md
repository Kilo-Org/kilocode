# Port the JetBrains plugin to v2

## Outcome

Preserve the original JetBrains experience through v2 public interfaces.

## Scope

Phase 5 — product clients. IDE plugin lifecycle, server discovery/authentication, session and terminal workflows.

## Current position

No port acceptance is recorded. Preserve the existing JetBrains product experience while replacing its backend integration; do not assume the VS Code adapter is reusable unchanged.

## Acceptance

- [ ] Inventory the existing plugin’s SDK, HTTP, event and terminal contracts and map each to a public v2 interface.
- [ ] Implement server startup/discovery, authentication and compatibility checks appropriate to the existing plugin lifecycle.
- [ ] Port session, streaming, cancellation, permissions, history and configuration workflows required by the original client.
- [ ] Identify dependencies on shared editor services such as FIM and generation without duplicating their implementation.
- [ ] Validate the real plugin in supported IDEs, including reconnect, restart and version mismatch handling.
- [ ] Update the JetBrains inventory row with remaining gaps and acceptance evidence.

## Dependencies and boundaries

Depends on stable public client contracts and applicable shared editor services. Completion of VS Code does not close this issue.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
