# Core - Messages Feature

**Quick Navigation for AI Agents**

---

## Overview

Message parsing and handling for AI responses. Parses assistant messages, extracts tool calls, and manages message flow.

**Source Location**: `src/core/assistant-message/`, `src/core/message-manager/`, `src/core/message-queue/`

---

## Components

| Component | Type | Location |
|-----------|------|----------|
| AssistantMessageParser | Class | `assistant-message/AssistantMessageParser.ts` |
| NativeToolCallParser | Class | `assistant-message/NativeToolCallParser.ts` |
| parseAssistantMessage | Function | `assistant-message/parseAssistantMessage.ts` |
| presentAssistantMessage | Function | `assistant-message/presentAssistantMessage.ts` |
| MessageManager | Class | `message-manager/index.ts` (8KB) |
| MessageQueue | Class | `message-queue/index.ts` |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Parse message | `parseAssistantMessage()` | `parseAssistantMessage.ts` |
| Parse tool calls | `parseToolCalls()` | `NativeToolCallParser.ts` |
| Present message | `presentAssistantMessage()` | `presentAssistantMessage.ts` |
| Queue message | `queueMessage()` | `message-queue/` |

---

## Message Flow

```
AI Response → Parser → Tool Calls → Execution → Results
                ↓
            Text Content → Display
```

---

## Kilocode-Specific

| File | Purpose |
|------|---------|
| `kilocode/gatekeeper.ts` | Message gatekeeper |
| `kilocode/native-tool-call.ts` | Kilocode tool calls |
| `kilocode/captureAskApprovalEvent.ts` | Capture approval events |

---

## Related

- [Task](../task/) - Tasks process messages
- [Shared Messages](../../../shared/features/messages/) - Message type definitions

---

[← Back to Core](../../Feature-Index.md)
