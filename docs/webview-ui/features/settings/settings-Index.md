# Webview UI - Settings Feature

**Quick Navigation for AI Agents**

---

## Overview

Settings panels (80+ components). Configures providers, models, UI preferences, and all Kilocode options.

**Source Location**: `webview-ui/src/components/settings/`

---

## Key Components

| Component | Purpose | File |
|-----------|---------|------|
| SettingsView | Main settings container | `SettingsView.tsx` |
| SettingsFooter | Footer controls | `SettingsFooter.tsx` |
| Section | Settings section wrapper | `Section.tsx` |
| SectionHeader | Section headers | `SectionHeader.tsx` |

---

## Configuration Components

| Component | Purpose |
|-----------|---------|
| ApiConfigSelector | API configuration |
| ModelSelector | Model selection |
| TemperatureControl | Temperature slider |
| ThinkingBudget | Extended thinking budget |
| RateLimitSecondsControl | Rate limits |

---

## Provider Settings (50+)

Located in `providers/`:

| Provider | File |
|----------|------|
| Anthropic | `Claude.tsx`, `Anthropic.tsx` |
| OpenAI | `OpenAI.tsx` |
| Gemini | `Gemini.tsx` |
| Bedrock | `Bedrock.tsx` |
| Ollama | `Ollama.tsx` |
| OpenRouter | `OpenRouter.tsx` |
| Mistral | `Mistral.tsx` |
| Groq | `Groq.tsx` |
| Cerebras | `Cerebras.tsx` |
| HuggingFace | `HuggingFace.tsx` |
| LMStudio | `LMStudio.tsx` |
| OpenAICompatible | `OpenAICompatible.tsx` |

---

## Rate Limit Components

| Component | Purpose |
|-----------|---------|
| ClaudeCodeRateLimitDashboard | Rate limit display |
| OpenRouterBalanceDisplay | Balance display |
| RooBalanceDisplay | Balance display |
| RequestyBalanceDisplay | Balance display |

---

## Other Settings

| Component | Purpose |
|-----------|---------|
| TerminalSettings | Terminal options |
| STTSettings | Speech-to-text |
| SlashCommandsSettings | Slash commands |
| UISettings | UI preferences |
| Verbosity | Logging verbosity |
| ModeSettings | Mode configuration |
| ProfileSelector | Profile selection |

---

[← Back to Webview UI](../../Feature-Index.md)
