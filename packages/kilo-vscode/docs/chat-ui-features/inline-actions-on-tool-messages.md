# Inline Actions on Tool Messages

Inline affordances on tool messages to navigate, inspect, and track progress.

## Location

- Various tool message components

## Interactions

- **FastApplyResult Display**: Shows results of fast-apply operations
- **Jump to File**: Opens files directly from file operation messages
- **External Link Icons**: Navigate to related files/resources
- **Progress Indicators**: Real-time status for long-running operations

## Suggested migration

**Reimplement?** Partial.

- Inline actions are mostly presentation-layer, but they depend on tool/result metadata being present in the message stream.
- With Kilo CLI owning orchestration, ensure the adapter:
  - preserves tool-call identifiers and status transitions (start/progress/finish) so existing progress indicators continue to work,
  - preserves file/diff references so jump-to-file and diff UIs remain functional.
- Kilo CLI UI reference: tool-part wrappers and permission prompts live in [`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilocode/blob/main/packages/ui/src/components/message-part.tsx:1), which is a good reference for the minimal metadata needed to support inline actions.
