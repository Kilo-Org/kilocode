---
description: Multi-model local review
agent: code
subtasks:
  - agent: general
    description: GPT-5.5 local review
    model: kilo/openai/gpt-5.5
  - agent: general
    description: Claude Opus 4.7 local review
    model: kilo/anthropic/claude-opus-4.7
synthesize: true
---
Use the local review prompt below to review this branch. Run the same review independently as your configured reviewer model, then the main agent will synthesize both reviews.

!`bun run --conditions=browser packages/opencode/src/kilocode/review/print.ts branch`
