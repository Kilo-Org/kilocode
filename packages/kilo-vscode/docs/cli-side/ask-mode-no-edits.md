# Ask Mode Should Not Make Edits

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6235](https://github.com/Kilo-Org/kilocode/issues/6235)

## Problem

In Ask mode, the agent is supposed to answer questions and discuss code without making any file edits. However, it has been observed making edits anyway. This violates the expected behavior of Ask mode and can surprise users who switch to Ask mode specifically to avoid accidental changes.

## Remaining Work

- Review the Ask mode system prompt and tool configuration in `packages/opencode/src/`
- Ensure that in Ask mode, the file write/edit tools (`write_file`, `edit_file`, `fast_edit`, etc.) are either:
  - Removed from the available tool set entirely for Ask mode sessions, or
  - The system prompt explicitly and firmly instructs the model not to use them
- The preferred fix is to disable the write tools at the tool configuration level, not just via prompt instruction, since models can sometimes ignore prompt-level restrictions
- Verify that read-only tools (read file, list directory, grep, etc.) remain available in Ask mode

## Implementation Notes

- Mode-specific tool availability is configured in the CLI's mode/agent setup
- Look for where the tool list is assembled for a session based on the active mode in `packages/opencode/src/`
- This is a CLI-side change; no extension-side changes needed
