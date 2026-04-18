# Defect Tribunal System

## Purpose
Prevent optimistic closure of defects that still block real-world use.

## Severity Levels
- **Critical** — blocks release, breaks core workflow, data loss risk, security vulnerability
- **High** — degrades major feature, no workaround available
- **Medium** — degrades feature but workaround exists, non-blocking
- **Low** — cosmetic, documentation, minor UX friction

## Escalation Timeline
- **Critical** — tribunal convened within 24 hours of report
- **High** — tribunal convened within 48 hours of report
- **Medium** — addressed at next scheduled review cycle
- **Low** — batched with phase completion review

## Trigger
A tribunal is mandatory when:
- a defect reopens more than once
- owner and challenger disagree
- evidence is ambiguous
- a phase claims pass while a critical issue remains

## Members
- Program Director
- subsystem owner
- subsystem challenger
- Evidence Steward
- Release Judge if severity is critical

## Possible Outcomes
- Reopen phase
- Accept with conditions
- Accept with waiver
- Reject as incomplete
