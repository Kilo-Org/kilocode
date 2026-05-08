---
description: Multi-model local review
agent: code
subtasks:
  - agent: review-gpt
    model: openai/gpt-5.5
  - agent: review-opus
    model: anthropic/claude-opus-4.7
synthesize: true
---
Use the local review prompt below to review this branch. Run the same review independently as your configured reviewer model, then the main agent will synthesize both reviews.

!`bun run --conditions=browser packages/opencode/src/kilocode/review/print.ts branch`
