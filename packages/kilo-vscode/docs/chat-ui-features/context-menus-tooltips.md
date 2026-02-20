# Context Menus & Tooltips (Webview)

Right-click/context actions and tooltip affordances within the chat webview UI.

> **Note:** For VS Code-native context menus (editor right-click, terminal right-click, code action lightbulb), see [Editor Context Menus & Code Actions](../non-agent-features/editor-context-menus-and-code-actions.md).

## Scope

This document covers **webview-internal** context menus and tooltips — i.e., right-click menus and hover tooltips rendered inside the Kilo Code chat panel.

## Current State

- kilo-ui provides `Tooltip` and `Popover` components, already in use throughout the webview (TaskHeader, ModelSelector, etc.)
- No webview-internal right-click context menu exists yet

## Remaining Work

- Add hover tooltips with explanatory text for all interactive buttons in the chat UI
- Implement right-click context menus on chat messages (copy, retry, edit, delete)
- Consider context menus on code blocks (copy code, insert at cursor, apply diff)

## Location

- [`webview-ui/src/components/common/ContextMenu.tsx`](../../webview-ui/src/components/common/ContextMenu.tsx:1)
- kilo-ui `Tooltip` component usage throughout webview

## Implementation Notes

These are presentation-layer affordances; the CLI backend is not involved. kilo-ui already provides the tooltip infrastructure needed.
