# API Providers - Google

**Quick Navigation for AI Agents**

---

## Overview

Google AI providers. Includes Gemini API and Vertex AI (for Claude and Gemini).

**Source Location**: `src/api/providers/gemini.ts`, `src/api/providers/anthropic-vertex.ts`

---

## Gemini Models

| Model | ID | Context | Best For |
|-------|-----|---------|----------|
| Gemini 1.5 Pro | `gemini-1.5-pro` | 1M | Long context |
| Gemini 1.5 Flash | `gemini-1.5-flash` | 1M | Fast responses |
| Gemini 1.0 Pro | `gemini-1.0-pro` | 32K | Standard tasks |

---

## Vertex AI Claude

Access Claude models via Google Cloud Vertex AI.

| Model | ID |
|-------|-----|
| Claude 3.5 Sonnet | `claude-3-5-sonnet@20241022` |
| Claude 3 Opus | `claude-3-opus@20240229` |
| Claude 3 Haiku | `claude-3-haiku@20240307` |

---

## Gemini Configuration

| Setting | Type | Description |
|---------|------|-------------|
| apiKey | string | Google AI API key |
| model | string | Model ID |
| maxTokens | number | Max output tokens |

---

## Vertex AI Configuration

| Setting | Type | Description |
|---------|------|-------------|
| projectId | string | GCP project ID |
| region | string | GCP region |
| model | string | Model ID |

---

## Features

- **Long Context**: Up to 1M tokens (Gemini)
- **Vision**: Image understanding
- **Grounding**: Web search grounding

---

[← Back to API Providers](../../Feature-Index.md)
