# Session Preview Improvements

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6234](https://github.com/Kilo-Org/kilocode/issues/6234)

## Problem

The session list on the home screen shows AI-generated session titles. These titles are often very short (3-5 words) and don't give enough context to distinguish between sessions at a glance. Users can't easily identify which session is which.

## Remaining Work

- Evaluate the session list display: compare auto-generated titles with showing the first message snippet (first ~100 characters of the user's opening message)
- Options to consider:
  1. Show the first user message as a subtitle below the title
  2. Improve title generation by prompting the CLI to generate more descriptive titles (e.g., include the key file or topic)
  3. Show a message count or timestamp to provide additional context
- Also review the three "recent sessions" cards on the start/home screen — ensure they have enough context for recognition
- User testing preferred: present the options to a small group to determine what is most useful

## Implementation Notes

- Session metadata (title, message count, timestamps) comes from the CLI's session list endpoint
- The session list component is in `webview-ui/src/`; the "first message snippet" approach requires fetching or caching the first message text
- If improving title generation: the CLI controls this; it may require a prompt change in `packages/opencode/`
