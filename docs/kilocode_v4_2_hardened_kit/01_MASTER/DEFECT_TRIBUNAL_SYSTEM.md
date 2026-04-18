# Defect Tribunal System

## Severity levels
- Low: annoyance, cosmetic issue, does not block core workflow
- Medium: partial workflow degradation, workaround exists
- High: major feature unreliable or unsafe, blocks intended use
- Critical: unsafe, bypassable, false-success, data-loss, or release-blocking defect

## When tribunal is required
- a defect reopens more than once
- owner and challenger disagree
- evidence is ambiguous
- a phase claims pass while high/critical issue remains
- any release-blocking issue exists

## Members
- Program Director
- subsystem owner
- subsystem challenger
- Evidence Steward
- Release Judge for high/critical cases

## Valid outcomes
- Reopen phase
- Accept with conditions
- Accept with formal waiver
- Reject as incomplete

## Release rule
Any critical defect blocks release.
High defects require explicit Release Judge sign-off to ship.
