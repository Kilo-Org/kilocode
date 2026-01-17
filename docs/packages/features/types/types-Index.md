# Packages - Types Feature

**Quick Navigation for AI Agents**

---

## Overview

Shared TypeScript types package (@roo-code/types). Contains type definitions, Zod schemas, and shared interfaces used across Kilocode.

**Source Location**: `packages/types/src/`

---

## Key Exports

### Interfaces

| Interface | Purpose |
|-----------|---------|
| `RooCodeAPI` | Public API interface |
| `ProviderSettings` | API provider configuration |
| `TaskLike` | Task interface |
| `TaskMetadata` | Task metadata |
| `ModelInfo` | Model information |

### Types

| Type | Purpose |
|------|---------|
| `ToolName` | Tool name union type |
| `ClineMessage` | Chat message type |
| `ClineAsk` | Ask message type |
| `ClineSay` | Say message type |
| `TokenUsage` | Token usage tracking |
| `ToolUsage` | Tool usage tracking |

### Enums

| Enum | Purpose |
|------|---------|
| `TaskStatus` | Task state enum |
| `RooCodeEventName` | Event names |
| `TelemetryEventName` | Telemetry events |

---

## Zod Schemas

Type validation using Zod:
- Configuration validation
- API response validation
- Message format validation

---

## Constants

| Constant | Purpose |
|----------|---------|
| `DEFAULT_CONSECUTIVE_MISTAKE_LIMIT` | Error limit |
| `DEFAULT_CHECKPOINT_TIMEOUT_SECONDS` | Checkpoint timeout |
| `MAX_CHECKPOINT_TIMEOUT_SECONDS` | Max timeout |
| `TOOL_PROTOCOL` | Tool protocol constant |

---

## Helper Functions

| Function | Purpose |
|----------|---------|
| `getApiProtocol()` | Get API protocol |
| `getModelId()` | Extract model ID |
| `isIdleAsk()` | Check ask type |
| `isNativeProtocol()` | Check protocol |

---

## Usage

```typescript
import {
  TaskStatus,
  ProviderSettings,
  ClineMessage
} from "@roo-code/types"
```

---

[← Back to Packages](../../Feature-Index.md)
