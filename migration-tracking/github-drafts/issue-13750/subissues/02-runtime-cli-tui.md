# Complete remaining runtime and CLI/TUI parity

## Outcome

Resolve behavioral gaps from the source assessment using Kilo-owned seams where possible.

## Scope

Runtime policy and lifecycle differences; notifications, themes, scope/projection behavior and CLI/TUI workflows.

## Current position

Many runtime slices are implemented and tested locally. Source assessment still records partial and missing behavior.

## Acceptance

- [ ] Verify network-waiting, overflow and snapshot policy differences against v1 behavior at the pinned v1 revision.
- [ ] Complete remaining notifications, theme and location/session projection requirements.
- [ ] Keep regression coverage for the Plan-to-Code handoff.
- [ ] Explain each necessary shared hook and remove change annotations that are unnecessary under the Kilo-owned path conventions.
- [ ] Update partial/needs-port inventory dispositions with behavioral acceptance results, actual consumer evidence and test limits.

## Dependencies and boundaries

Do not reopen native engines merely to match v1 file layout. Client-specific rendering and distribution have separate work items.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
