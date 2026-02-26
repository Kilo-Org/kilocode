# Plan Mode Over-Prompting to Implement

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6143](https://github.com/Kilo-Org/kilocode/issues/6143)

## Problem

In Plan mode, the agent repeatedly asks "Should I implement this?" even when the user wants to continue refining the plan. This interrupts the planning workflow and is frustrating for users who want to stay in discussion mode.

The agent appears to have been over-prompted toward implementation in a recent change to the Plan mode system prompt.

## Remaining Work

- Review the Plan mode system prompt in `packages/opencode/src/` for language that encourages the agent to switch to implementation
- The prompt should make clear that in Plan mode, the agent's job is to help create and refine a plan — not to implement it. The user explicitly controls when to switch to implementation
- The "Should I implement this?" question should be asked at most once, after the plan appears settled — not repeatedly during ongoing discussion
- Consider: the question should only appear if the user hasn't already answered "no" in the current conversation

## Implementation Notes

- This is a CLI-side change to the mode prompt in `packages/opencode/src/`
- Coordinate with the team on what the correct Plan mode behavior should be before changing the prompt
