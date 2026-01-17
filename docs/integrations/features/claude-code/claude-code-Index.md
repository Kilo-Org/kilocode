# Integrations - Claude Code Feature

**Quick Navigation for AI Agents**

---

## Overview

Claude Code integration. Handles OAuth authentication, streaming client, and message filtering for Kilocode-specific features.

**Source Location**: `src/integrations/claude-code/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| OAuth | Module | `oauth.ts` |
| StreamingClient | Class | `streaming-client.ts` |
| MessageFilter | Functions | `message-filter.ts` |

---

## OAuth Authentication

Handles user authentication via OAuth flow.

**Flow**:
1. User initiates login
2. Opens browser for OAuth
3. Receives callback with token
4. Stores token securely

**Key Functions**:
| Function | Purpose |
|----------|---------|
| `initiateOAuth()` | Start OAuth flow |
| `handleCallback()` | Process OAuth callback |
| `getToken()` | Get stored token |
| `logout()` | Clear authentication |

---

## StreamingClient

Handles streaming responses from Claude Code API.

**Features**:
- Real-time streaming
- Connection management
- Error handling
- Reconnection logic

---

## MessageFilter

Filters messages for Claude Code-specific processing.

**Features**:
- Filter internal messages
- Transform message format
- Handle special message types

---

## Use Cases

1. **Pro Features**: Access premium features
2. **Cloud Sync**: Sync settings across devices
3. **Team Features**: Team/organization support

---

## Related

- [Cloud Package](../../../packages/features/cloud/) - Cloud services
- [CLI Auth](../../../cli/features/auth/) - CLI authentication

---

[← Back to Integrations](../../Feature-Index.md)
