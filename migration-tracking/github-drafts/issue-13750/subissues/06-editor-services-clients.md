# Complete remaining editor services

## Outcome

Complete feature-specific editor services beyond basic VS Code chat parity.

## Scope

Inline autocomplete/FIM and next edit; code actions and SCM generation workflows; speech and other source-assessed editor services.

## Current position

Stateless generation adapters have local coverage. That does not establish editor workflow, provider or additional-client acceptance.

## Acceptance

- [ ] Inventory each remaining service against its actual original consumer and v2 destination.
- [ ] Implement and validate FIM/next-edit producer and editor integration.
- [ ] Verify code actions, enhance prompt and commit generation in their real UI/SCM workflows.
- [ ] Complete speech capture/transcription integration and provider acceptance.
- [ ] Complete image generation and Claw consumer/service integration, with actual provider acceptance.
- [ ] Assign remaining feature services independent follow-ups when ownership is known; record any scope removal as a product decision.

## Dependencies and boundaries

Coordinate with original VS Code parity for shared host plumbing. JetBrains and additional runtime consumers have separate integration workstreams. Split editor services further by owner when useful.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
