# Plan Mode Over-Prompting to Implement

**Priority:** P1
**Issue:** [#6143](https://github.com/Kilo-Org/kilocode/issues/6143)

An experimental plan mode prompt exists (`Flag.KILO_EXPERIMENTAL_PLAN_MODE`) that is verbose. Agent still tends to ask "Should I implement this?" repeatedly.

## Remaining Work

- Review the Plan mode system prompt for language that encourages the agent to switch to implementation
- The prompt should make clear that in Plan mode, the agent's job is to help create and refine a plan — not implement
- "Should I implement this?" should be asked at most once, after the plan appears settled
- Coordinate with team on correct Plan mode behavior before changing the prompt
