# Prompt Improvement Feature

**Priority:** P3
**Status:** ❌ Not started
**Issue:** [Kilo-Org/kilo#594](https://github.com/Kilo-Org/kilo/issues/594) (private)

## Summary

A feature to help users improve their prompts before sending — likely an "Improve prompt" button in the chat input that rewrites or enhances the user's message using AI assistance.

## Remaining Work

Details are tracked in the private issue. At a high level:

- Add an "Improve prompt" button or keyboard shortcut in the chat input area
- When triggered, send the current draft message to the CLI/API to be rewritten into a more effective prompt
- Show the improved version as a preview; let the user accept, edit, or dismiss it
- The improvement request should go through the existing session or a lightweight one-shot endpoint

## Implementation Notes

- This feature requires CLI-side support for a "rewrite prompt" endpoint, or it can be done client-side by sending a meta-prompt to the model
- Design should avoid blocking the main chat input while the improvement request is in flight
