# Dead Code Detection Guide

This guide explains how to **FIND** unused/dead code in the codebase. The aim is to iteratively and in small steps delete dead code.
There's no need to find ALL dead code up front. Once you've identified any dead code dead code, delegate removal (in small batches) to a [`CODE_CLEANUP_INSTRUCTIONS.md`](CODE_CLEANUP_INSTRUCTIONS.md) following subtask to safely remove it.

## Quick Start: How to Find Dead Code

### Step 1; eslint

Run these commands to find unused functions, variables, and parameters within files:

```bash
npm run lint
```

Group any unused code into a superficially related looking batch (e.g. by file), and then start a subtask to remove the code in that batch with instructions to follow [`CODE_CLEANUP_INSTRUCTIONS.md`](CODE_CLEANUP_INSTRUCTIONS.md) for the safe removal process.

### Step 2; knip

```bash
npx knip  # Analyzes module graph for unused exports
```

Knip will list:

- Files not reachable from entry points: group any unused code into a superficially related looking batch (e.g. by file), and then start a subtask to remove the code in that batch with instructions to follow [`CODE_CLEANUP_INSTRUCTIONS.md`](CODE_CLEANUP_INSTRUCTIONS.md) for the safe removal process.

- Exported functions/classes/types that nothing imports: start a subtask not to REMOVE the code but instead to NOT EXPORT the code; this too needs to follow at least the safety instructions from [`CODE_CLEANUP_INSTRUCTIONS.md`](CODE_CLEANUP_INSTRUCTIONS.md).

- Dependencies in package.json that aren't used: start a subtask to remove the code in that batch with instructions to follow [`CODE_CLEANUP_INSTRUCTIONS.md`](CODE_CLEANUP_INSTRUCTIONS.md) for the safe removal process, emphasizing the need to run NPM install!

### Step 3; loop:

These tools are complementary. It's possible knip's export removal allowed for more internal functions to be removed and vice-versa. So, if prior steps removed anything, then start over at step 1 until there are no more changes made, skipping any removal suggestions when prior attempts to remove that code already failed (since that demonstrates the code is implicitly used).

## Reminder

When you've identified unused code with these tools, it should be removed.
Do so bit by bit VIA SUBTASKS; i.e. don't try to remove everything at once and don't do it yourself, but small chunks at a time,
so that unforeseen implicit usages can be granularly caught by trial and error. To remove dead code,
start a subprocess that follows [`CODE_CLEANUP_INSTRUCTIONS.md`](CODE_CLEANUP_INSTRUCTIONS.md)
That document explains:

- How to safely remove code without breaking tests
- How to handle cascading deletions (removing one thing makes others unused)
- How to verify removals are safe
- What to include in each removal (implementations, interfaces, types, helpers)
- How to commit removals properly

**The detection tools (this guide) tell you WHAT to remove. The cleanup instructions tell you HOW to remove it safely.**
