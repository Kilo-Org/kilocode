# Special Content Types

**Priority:** P1
**Status:** 🔨 Partial

## What Exists

- Reasoning blocks render as collapsible sections via `PART_MAPPING["reasoning"]`
- Rich per-tool renderers for read, edit, write, apply_patch, bash, glob, grep, webfetch, task, todowrite, todoread, question
- Error cards with icon, title, and message via `Card variant="error"`
- Unregistered/MCP tools fall through to `GenericTool` display

## Remaining Work

- Copy button on error cards (error text displays but no dedicated copy action)
- Dedicated MCP tool/resource rows with specialized rendering (beyond generic fallback)
- "Open markdown preview" button (opens rendered markdown in VS Code's preview pane)
