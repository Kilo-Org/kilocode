# Toggle Thinking

**Priority:** P2
**Status:** 🔨 Partial (linked)

## Description

Allow users to enable or disable "thinking" (extended reasoning) for models that support it.

## Requirements

- Toggle control to enable/disable thinking mode
- When thinking is enabled, model uses extended reasoning (e.g., Claude's extended thinking)
- When thinking is disabled, model responds without extended thinking
- Toggle should be accessible from the chat UI (e.g., in prompt input area or task header)
- Setting should persist across sessions

## Current State

Reasoning/thinking blocks already render in the chat (collapsible sections in [`Message.tsx`](../../webview-ui/src/components/chat/Message.tsx)). A linked PR (#127) exists suggesting work is in progress.

## Gaps

- No toggle control in the UI to enable/disable thinking
- No setting persistence for thinking preference
- Need to determine how to pass thinking preference to CLI backend
