# Complete remote session consumer acceptance

## Outcome

Validate the v2 remote adapter against actual relay and client behavior.

## Scope

Subscription scope, event/transcript projection, inline attachments, suggestions, reconnect and exit lifecycle.

## Current position

Local transport, attachment capability advertisement and suggestion lifecycle have focused coverage. Deployed consumer acceptance remains separate.

## Acceptance

- [ ] Verify actual relay/client contract compatibility when external access is authorized.
- [ ] Exercise streamed transcript, attachments and reconnect without duplicate or missing content.
- [ ] Exercise suggestion accept/dismiss/cancel and subscribed-session ownership.
- [ ] Verify exit and interruption semantics through the consuming client.
- [ ] Resolve remaining metadata differences from v1 or record a product decision.
- [ ] Keep unsupported capabilities unadvertised and preserve local regression coverage.

## Dependencies and boundaries

Session sharing persistence is tracked separately.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
