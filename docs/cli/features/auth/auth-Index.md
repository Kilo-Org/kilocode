# CLI - Auth Feature

**Quick Navigation for AI Agents**

---

## Overview

CLI authentication system. Handles user login, token management, and authentication providers.

**Source Location**: `cli/src/auth/`

---

## Components

| Component | Type | Location |
|-----------|------|----------|
| AuthService | Class | `index.ts` |
| Providers | Module | `providers/` |
| Utils | Functions | `utils/` |

---

## Authentication Methods

| Method | Description |
|--------|-------------|
| API Key | Direct API key authentication |
| OAuth | OAuth flow via browser |
| Token | Pre-existing token |

---

## Quick Reference

| Operation | Command/Method |
|-----------|----------------|
| Login | `kilocode login` |
| Logout | `kilocode logout` |
| Check status | `kilocode auth status` |
| Set API key | `kilocode config set apiKey <key>` |

---

## Token Storage

- Tokens stored securely in system keychain
- Fallback to encrypted file storage
- Automatic token refresh

---

## Provider Configuration

Different providers have different auth requirements:

| Provider | Auth Type |
|----------|-----------|
| Anthropic | API Key |
| OpenAI | API Key |
| Claude Code | OAuth |
| Ollama | None (local) |

---

## Related

- [Claude Code Integration](../../../integrations/features/claude-code/) - OAuth flow
- [CLI Commands](../commands/) - Auth commands

---

[← Back to CLI](../../Feature-Index.md)
