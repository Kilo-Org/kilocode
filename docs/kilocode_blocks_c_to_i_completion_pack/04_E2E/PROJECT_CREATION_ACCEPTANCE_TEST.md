# Project Creation Acceptance Test

Use the system to create a small real project end-to-end.

Required flow:
1. User requests project creation
2. Claude creates contract/spec
3. Hermes routes execution
4. ZeroClaw performs bounded file creation/commands
5. KiloCode shows files/diffs/logs
6. Project runs or tests pass
7. Memory entry written
8. Run ledger appended

Pass only if the project actually runs or its test passes.
