# Assess and integrate cloud agent consumers with v2

## Outcome

Establish and implement v2 compatibility for cloud agent consumers.

## Scope

Phase 5 — cloud agent startup, runtime/client contracts, execution lifecycle and persistence, with phase 6 deployment/cutover dependencies.

## Current position

Cloud agent integration needs a dedicated consumer/contract assessment. Existing kilo cloud CLI coverage, remote relay coverage, and Agent Manager UI work do not establish compatibility of cloud-hosted agent execution.

## Acceptance

- [ ] Identify actual cloud agent consumers, repositories, owners and deployed runtime versions; define which are in migration scope.
- [ ] Map startup, session admission, streaming, tools, credentials, persistence and cancellation contracts from actual consumers.
- [ ] Determine whether each consumer needs a v2 client adaptation, runtime packaging changes, or no change, with evidence.
- [ ] Implement the confirmed gaps through public interfaces and track cross-repository dependencies.
- [ ] Validate local contracts separately from hosted execution, recovery and deployment acceptance.
- [ ] Document rollout compatibility and update the detailed plan before claiming integration complete.

## Dependencies and boundaries

Coordinate with distribution, remote and sharing only where their contracts are actually consumed. Hosted acceptance remains outstanding until authorized and executed; do not substitute local fixtures for it.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
