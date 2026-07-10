---
name: brainstorming
description: Decide whether to work directly, delegate to one agent, or consult multiple agents before non-trivial work.
---

# Brainstorming

Use this skill during planning phases, before risky work, or when you are stuck.
Do not use it for trivial single-step requests or when the user asked for exact command execution or raw output.

## When to use it

- ambiguous or multi-part requests
- multi-file or multi-package work
- risky refactors, rollouts, or git operations
- debugging when multiple causes look plausible
- architecture or tradeoff questions
- deciding which agents, skills, or tools should be involved

## Goals

1. Decide whether to act directly or delegate.
2. If delegating, choose the smallest useful set of distinct agents.
3. Decide whether a multi-agent consultation is worth the cost.
4. Produce an ordered plan with one clear execution owner.

## Process

1. Define the goal, constraints, and success criteria.
2. Classify the work:
   - direct/self-execute
   - single specialist
   - parallel consultation
   - sequential wave plan
3. Identify candidate agents and what unique value each adds.
4. Only fan out when it is high leverage.
   - Cap the panel to 2-4 distinct agents.
   - Do not send duplicate agent types in the same wave.
   - Prefer cheap or highly specialized lanes first.
5. If consulting multiple agents, ask each for a different angle:
   - implementation plan
   - architecture and codebase facts
   - risk review
   - debugging hypothesis
   - git workflow
6. Compare outputs:
   - shared conclusions
   - strongest disagreement
   - cheapest safe next step
7. Pick one execution owner and, if needed, one validator.
8. Prevent recursion:
   - delegated agents may do a light local planning pass
   - they should not fan out again unless explicitly justified

## Output template

- GOAL
- CONSTRAINTS
- OPTIONS
- PANEL
- OWNER
- PLAN

## Agent-selection hints

- `general`: implementation, synthesis, multi-step work
- `explore`: codebase search and factual lookup
- `frontend`: UI, rendering, JSX, SolidJS, TUI
- `debug`: reproduction, logs, root-cause isolation
- `reviewer`: risk, regressions, scope checks
- `repo-architecture-explainer`: structure, boundaries, reading path
- `git-ops`: safe git workflows and sequencing
- `failing-test-triage`: failing-test diagnosis
- `command-check`: exact command execution or raw output only

## Important limits

- If the user asked for exact commands or verbatim output, skip this skill and execute literally.
- If the task is trivial, skip this skill.
- If you do not have the `task` tool, use this skill to pick your own tactic rather than delegating.
- When in doubt, prefer a small plan and one owner over a large debate.
