# Packages - Telemetry Feature

**Quick Navigation for AI Agents**

---

## Overview

Telemetry package (@roo-code/telemetry). Analytics and usage tracking using PostHog.

**Source Location**: `packages/telemetry/src/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| BaseTelemetryClient | Class | `BaseTelemetryClient.ts` | 3KB |
| PostHogTelemetryClient | Class | `PostHogTelemetryClient.ts` | 5KB |
| TelemetryService | Class | `TelemetryService.ts` | 9KB |

---

## TelemetryService

Main telemetry orchestrator.

**Key Methods**:
| Method | Purpose |
|--------|---------|
| `track()` | Track event |
| `identify()` | Identify user |
| `setProperties()` | Set user properties |
| `flush()` | Flush pending events |

---

## PostHogTelemetryClient

PostHog integration client.

**Features**:
- Event tracking
- User identification
- Property tracking
- Batch sending

---

## Tracked Events

| Event | Description |
|-------|-------------|
| `task_started` | Task initiated |
| `task_completed` | Task finished |
| `tool_used` | Tool invoked |
| `error_occurred` | Error happened |
| `model_changed` | Model switched |

---

## Privacy

- **Opt-out**: Users can disable telemetry
- **Anonymization**: PII is not collected
- **Local-only**: Option to disable all tracking

---

## Configuration

```typescript
{
  enabled: boolean;      // Enable/disable telemetry
  anonymousId: string;   // Anonymous identifier
}
```

---

[← Back to Packages](../../Feature-Index.md)
