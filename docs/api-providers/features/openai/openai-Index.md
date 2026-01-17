# API Providers - OpenAI

**Quick Navigation for AI Agents**

---

## Overview

OpenAI GPT API provider. Supports GPT-4, GPT-4 Turbo, GPT-3.5 Turbo, and o1 models.

**Source Location**: `src/api/providers/openai.ts`

---

## Supported Models

| Model | ID | Context | Best For |
|-------|-----|---------|----------|
| GPT-4o | `gpt-4o` | 128K | General purpose |
| GPT-4o mini | `gpt-4o-mini` | 128K | Fast, cost-effective |
| GPT-4 Turbo | `gpt-4-turbo` | 128K | Complex tasks |
| o1 | `o1` | 128K | Reasoning |
| o1-mini | `o1-mini` | 128K | Fast reasoning |
| o1-preview | `o1-preview` | 128K | Preview reasoning |

---

## Configuration

| Setting | Type | Description |
|---------|------|-------------|
| apiKey | string | OpenAI API key |
| model | string | Model ID |
| maxTokens | number | Max output tokens |
| temperature | number | 0-2, creativity |
| baseUrl | string | Custom endpoint (optional) |

---

## Features

- **Vision**: Image understanding (GPT-4V)
- **Tool Use**: Function calling
- **JSON Mode**: Structured output
- **Streaming**: Real-time streaming

---

## API Endpoint

```
https://api.openai.com/v1/chat/completions
```

---

## Related Providers

- [Azure OpenAI](../openai/) - OpenAI on Azure
- [OpenRouter](../openrouter/) - Access via OpenRouter

---

[← Back to API Providers](../../Feature-Index.md)
