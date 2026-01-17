# Core - Config Feature

**Quick Navigation for AI Agents**

---

## Overview

Configuration management for Kilocode. Handles custom modes (roles/permissions), provider settings (API keys, models), and context proxy for state management.

**Source Location**: `src/core/config/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| CustomModesManager | Class | `CustomModesManager.ts` | 41KB |
| ProviderSettingsManager | Class | `ProviderSettingsManager.ts` | 34KB |
| ContextProxy | Class | `ContextProxy.ts` | 17KB |
| importExport | Functions | `importExport.ts` | - |

---

## Documentation Files

- **[CustomModes.md](./CustomModes.md)** - Custom modes system
- **[ProviderSettings.md](./ProviderSettings.md)** - Provider configuration
- **[ContextProxy.md](./ContextProxy.md)** - Context proxy

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Get custom modes | `getModes()` | `CustomModesManager.ts` |
| Create mode | `createMode()` | `CustomModesManager.ts` |
| Get provider settings | `getSettings()` | `ProviderSettingsManager.ts` |
| Update API key | `updateApiKey()` | `ProviderSettingsManager.ts` |
| Get context | `getContext()` | `ContextProxy.ts` |

---

## Custom Modes

Modes define AI behavior:
- **Role name**: What the AI acts as
- **Role definition**: Detailed instructions
- **File permissions**: Regex patterns for allowed files
- **Tool permissions**: Which tools can be used

**Built-in Modes**:
- `code` - Software engineer mode
- `architect` - System design mode
- `ask` - Question answering mode

---

## Provider Settings

Configuration for AI providers:
- API keys
- Model selection
- Temperature
- Max tokens
- Custom endpoints

---

## Kilocode-Specific

| File | Purpose |
|------|---------|
| `kilocode/` | Kilocode config migrations |

---

## Related Features

- [Prompts](../prompts/) - System prompts use mode config
- [API Providers](../../../api-providers/) - Provider implementations

---

[← Back to Core](../../Feature-Index.md)
