# Reasoning Block Styling

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6254](https://github.com/Kilo-Org/kilocode/issues/6254)

## Problem

Reasoning traces (the model's internal "thinking" output) are not visually distinguishable from the regular agent output. When reasoning and response text look identical, users can't tell what the model is "thinking" versus what it's actually saying, and the UI can feel slow because there's no clear progress indicator.

## Remaining Work

- Apply a distinct visual style to reasoning block content in the chat:
  - A subtly different background (e.g., a slightly muted/transparent overlay using VS Code's sidebar background token)
  - An italic font or reduced opacity to signal this is internal thinking, not final output
  - A label or icon at the top of the block (e.g., a small "Thinking…" label or brain icon) to identify the block type
- The styling must work across light, dark, and high-contrast themes — use CSS variables, not hardcoded colors
- Collapse reasoning blocks by default with an expand toggle, since they can be very long (see PR [#6217](https://github.com/Kilo-Org/kilocode/pull/6217) for prior work)
- Follow existing kilo-ui patterns for collapsible sections

## Implementation Notes

- Reasoning blocks are a specific message part type in the CLI's message schema
- The rendering component is in kilo-ui or `webview-ui/src/`; identify which component handles `reasoning` or `thinking` part types
