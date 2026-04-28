# Quality

This file tracks current quality posture and standards adoption. Update it when checks become enforceable or major risks are retired.

## Scorecard

|Area|Score|Notes|
|---|---|---|
|Agent legibility|B|Root map and engineering docs exist; deeper docs need ongoing gardening.|
|Mechanical enforcement|C|Source links, fork markers, typecheck, and tests exist; Harness standards start in warn mode.|
|Fork hygiene|B-|Dedicated `devilcode` paths exist; marker terminology and workflow guards had drift.|
|Local validation|B-|Commands are documented; worktree boot and UI evidence loops need more automation.|
|CI reliability|C+|Core workflows exist, but disabled jobs and stale repository guards need cleanup.|
|Entropy control|C|Placeholder scripts and stale naming were present; standards check now reports this class of issue.|

## Known Risks

- Mixed Devil/Kilo naming can confuse agents unless compatibility exceptions are documented.
- Disabled or stale workflows reduce trust in CI as the source of truth.
- Large instruction files can crowd out task context and drift from code behavior.
- Shared OpenCode edits are easy to miss without marker checks.
- The app and desktop packages are upstream-synced and not actively maintained, so broad changes there carry merge risk.

## Update Policy

- Update this scorecard when `standards:enforce` gains or loses a blocking rule.
- Track repeated review comments as either documentation updates or mechanical checks.
- Prefer small cleanup PRs over broad unowned refactors.
