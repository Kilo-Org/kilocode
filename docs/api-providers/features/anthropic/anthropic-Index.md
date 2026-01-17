# API Providers - Anthropic

**Quick Navigation for AI Agents**

---

## Overview

Anthropic Claude API provider. Supports Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku, and other Claude models.

**Source Location**: `src/api/providers/anthropic.ts`

---

## Supported Models

| Model | ID | Context | Best For |
|-------|-----|---------|----------|
| Claude 3.5 Sonnet | `claude-3-5-sonnet-20241022` | 200K | Coding, analysis |
| Claude 3 Opus | `claude-3-opus-20240229` | 200K | Complex reasoning |
| Claude 3 Haiku | `claude-3-haiku-20240307` | 200K | Fast, simple tasks |
| Claude 3.5 Haiku | `claude-3-5-haiku-20241022` | 200K | Fast, balanced |

---

## Configuration

| Setting | Type | Description |
|---------|------|-------------|
| apiKey | string | Anthropic API key |
| model | string | Model ID |
| maxTokens | number | Max output tokens |
| temperature | number | 0-1, creativity |

---

## Features

- **Extended Thinking**: Beta feature for complex reasoning
- **Vision**: Image understanding
- **Tool Use**: Native tool calling
- **Streaming**: Real-time response streaming

---

## API Endpoint

```
https://api.anthropic.com/v1/messages
```

---

## Related Providers

- [Anthropic Vertex](../google/) - Claude on Google Cloud
- [AWS Bedrock](../aws/) - Claude on AWS

---

[← Back to API Providers](../../Feature-Index.md)
