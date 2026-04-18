# Operator Runbook

## Daily operating loop
1. Open PHASE_TRACKER.csv and select the next unlocked phase.
2. Confirm prerequisites from PHASE_DEPENDENCY_MAP.md.
3. Run owner implementation for the selected phase.
4. Capture evidence into the correct evidence bundle path.
5. Run confirmer review using the relevant validator.
6. Run challenger attack on failure paths and safety conditions.
7. Update FEATURE_TRUTH_MATRIX.md, DEFECT_LEDGER.md, and RUN_LEDGER.
8. Pass, reopen, or escalate to tribunal.

## Recommended tooling
- use Claude for contract control, audits, and final verdicts
- use execution agents for implementation work
- use Hermes for routing, memory, and policy
- use ZeroClaw for sandboxed execution
- use KiloCode as the cockpit and review surface

## Escalation
Escalate when:
- owner and challenger disagree
- evidence is ambiguous
- high/critical defect remains
- phase claims pass but a validator fails

## Minimum evidence per phase
- one runtime or log artifact
- one config or data-path reference
- one failure-path check
- truth-matrix update
