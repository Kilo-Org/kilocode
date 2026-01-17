# Packages - Cloud Feature

**Quick Navigation for AI Agents**

---

## Overview

Cloud services package (@roo-code/cloud). Handles cloud sync, authentication, sharing, and bridge communication.

**Source Location**: `packages/cloud/src/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| CloudAPI | Class | `CloudAPI.ts` |
| CloudService | Class | `CloudService.ts` |
| CloudSettingsService | Class | `CloudSettingsService.ts` |
| CloudShareService | Class | `CloudShareService.ts` |
| WebAuthService | Class | `WebAuthService.ts` |
| RefreshTimer | Class | `RefreshTimer.ts` |

---

## Bridge Components

| Component | File | Purpose |
|-----------|------|---------|
| BridgeOrchestrator | `bridge/BridgeOrchestrator.ts` | Coordinate bridge |
| ExtensionChannel | `bridge/ExtensionChannel.ts` | Extension communication |
| TaskChannel | `bridge/TaskChannel.ts` | Task communication |
| SocketTransport | `bridge/SocketTransport.ts` | WebSocket transport |

---

## CloudService

Main cloud service orchestrator.

**Features**:
- Authentication management
- Settings sync
- Share functionality
- Connection handling

---

## CloudSettingsService

Syncs settings to cloud.

**Features**:
- Upload settings
- Download settings
- Conflict resolution
- Selective sync

---

## CloudShareService

Handles sharing conversations/tasks.

**Features**:
- Generate share links
- Access control
- Expiration management

---

## WebAuthService

OAuth authentication for web.

**Features**:
- OAuth flow
- Token management
- Session handling

---

## Bridge Architecture

```
Extension ←→ BridgeOrchestrator ←→ Cloud
              ↓
         SocketTransport
              ↓
        TaskChannel / ExtensionChannel
```

---

[← Back to Packages](../../Feature-Index.md)
