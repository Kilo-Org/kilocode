# Assess and integrate Anaconda Desktop and related clients with v2

## Outcome

Establish and implement v2 compatibility for Anaconda Desktop.

## Scope

Phase 5 — additional clients. Desktop startup, authentication, session workflows and runtime compatibility; discovery establishes the exact integration mode.

## Current position

Discovery is required before implementation scope can be established. Inspect the existing desktop integration methods and their actual consumers; verify their v2 compatibility.

## Acceptance

- [ ] Identify the exact Anaconda Desktop product, source repository, owner and supported integration mode.
- [ ] Inspect its actual Kilo dependency: binary invocation, SDK/HTTP, ACP, extension bridge or another contract.
- [ ] Assess startup, identity/storage, authentication, session lifecycle and version negotiation where applicable.
- [ ] Record an evidence-backed no-change result or implement each required adaptation.
- [ ] Validate the actual client workflow, including failures and upgrade compatibility.
- [ ] Add any other discovered consumers as named inventory entries with owners and separate follow-ups when independently actionable.

## Dependencies and boundaries

Start with discovery rather than presumed implementation. Native ACP support or a working standalone Kilo CLI does not by itself prove this client’s compatibility.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
