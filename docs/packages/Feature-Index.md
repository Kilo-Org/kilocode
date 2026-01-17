# Packages Module Features

**Quick Navigation for AI Agents**

---

## Overview

Shared npm packages used across Kilocode. Contains cloud services, telemetry, types, IPC, and build utilities.

**Source Location**: `packages/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[cloud](./features/cloud/)** | Cloud sync, auth, sharing | `CloudAPI.ts`, `CloudService.ts`, `WebAuthService.ts` |
| **[telemetry](./features/telemetry/)** | Analytics (PostHog) | `TelemetryService.ts`, `PostHogTelemetryClient.ts` |
| **[types](./features/types/)** | Shared TypeScript types | `@roo-code/types` |

---

## All Packages

| Package | npm Name | Purpose |
|---------|----------|---------|
| `core/` | `@roo-code/core` | Core shared utilities |
| `types/` | `@roo-code/types` | Type definitions, Zod schemas |
| `cloud/` | `@roo-code/cloud` | Cloud services, sync |
| `telemetry/` | `@roo-code/telemetry` | PostHog telemetry |
| `ipc/` | `@roo-code/ipc` | Inter-process communication |
| `core-schemas/` | `@kilocode/core-schemas` | Zod schemas for config |
| `evals/` | `@roo-code/evals` | Evaluation framework |
| `build/` | `@roo-code/build` | Build utilities (esbuild) |
| `config-eslint/` | `@roo-code/config-eslint` | ESLint config |
| `config-typescript/` | `@roo-code/config-typescript` | TypeScript config |

---

## Cloud Package Architecture

```
packages/cloud/src/
├── CloudAPI.ts           → Cloud API client
├── CloudService.ts       → Main cloud service
├── CloudSettingsService.ts → Settings sync
├── CloudShareService.ts  → Share functionality
├── WebAuthService.ts     → OAuth
├── RefreshTimer.ts       → Token refresh
├── bridge/               → Cloud-extension bridge
│   ├── BridgeOrchestrator.ts
│   ├── ExtensionChannel.ts
│   ├── TaskChannel.ts
│   └── SocketTransport.ts
└── retry-queue/          → Retry logic
```

---

## Telemetry Package

| File | Purpose |
|------|---------|
| `BaseTelemetryClient.ts` | Base telemetry class (3KB) |
| `PostHogTelemetryClient.ts` | PostHog integration (5KB) |
| `TelemetryService.ts` | Main service (9KB) |

---

[← Back to Index](../Index.md)
