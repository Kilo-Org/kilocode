# API Providers - OpenRouter

**Quick Navigation for AI Agents**

---

## Overview

OpenRouter API aggregator. Access 100+ models from multiple providers through a single API.

**Source Location**: `src/api/providers/openrouter.ts`

---

## Features

- **Multi-Provider**: Access Claude, GPT, Llama, Mistral, etc.
- **Single API Key**: One key for all models
- **Fallback**: Automatic model fallback
- **Cost Tracking**: Usage and cost monitoring

---

## Configuration

| Setting | Type | Description |
|---------|------|-------------|
| apiKey | string | OpenRouter API key |
| model | string | Model ID |
| maxTokens | number | Max output tokens |

---

## Popular Models

| Model | Provider | ID |
|-------|----------|-----|
| Claude 3.5 Sonnet | Anthropic | `anthropic/claude-3.5-sonnet` |
| GPT-4o | OpenAI | `openai/gpt-4o` |
| Llama 3.1 70B | Meta | `meta-llama/llama-3.1-70b-instruct` |
| Mistral Large | Mistral | `mistralai/mistral-large` |
| Gemini Pro | Google | `google/gemini-pro` |

---

## API Endpoint

```
https://openrouter.ai/api/v1/chat/completions
```

---

## Pricing

- Pay-per-token pricing
- Varies by model
- No minimum commitment
- Credit-based billing

---

## Use Cases

- **Model Comparison**: Test different models
- **Fallback**: Use backup models
- **Cost Optimization**: Choose cost-effective models
- **Access**: Models not directly available

---

[← Back to API Providers](../../Feature-Index.md)
