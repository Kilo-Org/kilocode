# Expandable MCP Tools in Chat

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6229](https://github.com/Kilo-Org/kilocode/issues/6229)

## Problem

Regular (non-MCP) tool calls in the chat can be expanded to see their inputs and outputs. MCP tool calls currently render as non-expandable entries, so users cannot inspect what was sent or received.

## Remaining Work

- Make MCP tool call rows in the chat expandable, matching the expand/collapse behavior of regular tool rows
- Expanded view should show:
  - Tool name and MCP server name
  - Input arguments (JSON formatted)
  - Tool output / result
- The expand toggle should use the same UI pattern as regular tools (chevron/arrow icon, collapsible section)

## Implementation Notes

- MCP tool calls arrive as message parts from the CLI with a specific part type
- The rendering component for MCP tools is in kilo-ui or `webview-ui/src/`; identify where the non-expandable MCP tool row is rendered and add expand logic
- Input/output data should already be present in the message part payload — this is a rendering-only change
