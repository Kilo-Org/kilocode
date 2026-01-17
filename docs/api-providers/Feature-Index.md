# API Providers Module Features

**Quick Navigation for AI Agents**

---

## Overview

50+ AI model provider implementations. Supports Anthropic, OpenAI, Google, AWS, local models, and many more through a unified provider interface.

**Source Location**: `src/api/providers/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[anthropic](./features/anthropic/)** | Claude models (Anthropic API) | `anthropic.ts` |
| **[openai](./features/openai/)** | GPT models (OpenAI API) | `openai.ts` |
| **[google](./features/google/)** | Gemini, Vertex AI | `gemini.ts`, `anthropic-vertex.ts` |
| **[aws](./features/aws/)** | AWS Bedrock | `bedrock.ts` |
| **[local-models](./features/local-models/)** | Ollama, LMStudio, local inference | `ollama.ts`, `lmstudio.ts` |
| **[openrouter](./features/openrouter/)** | OpenRouter aggregator | `openrouter.ts` |

---

## All Providers

| Provider | File | Category |
|----------|------|----------|
| Anthropic | `anthropic.ts` | Cloud |
| Anthropic Vertex | `anthropic-vertex.ts` | Cloud |
| OpenAI | `openai.ts` | Cloud |
| Azure OpenAI | `azure-openai.ts` | Cloud |
| Gemini | `gemini.ts` | Cloud |
| Bedrock | `bedrock.ts` | Cloud |
| Ollama | `ollama.ts` | Local |
| LMStudio | `lmstudio.ts` | Local |
| OpenRouter | `openrouter.ts` | Aggregator |
| Mistral | `mistral.ts` | Cloud |
| Groq | `groq.ts` | Cloud |
| Cerebras | `cerebras.ts` | Cloud |
| DeepSeek | `deepseek.ts` | Cloud |
| Grok | `grok.ts` | Cloud |
| HuggingFace | `huggingface.ts` | Cloud |
| Together | `together.ts` | Cloud |
| Fireworks | `fireworks.ts` | Cloud |

---

## Base Classes

| Class | Purpose | File |
|-------|---------|------|
| BaseProvider | Abstract base for all providers | `base-provider.ts` |
| BaseOpenAICompatibleProvider | OpenAI-compatible base | `base-openai-compatible-provider.ts` |
| RouterProvider | Route between providers | `router-provider.ts` |

---

## Key Concepts

- **Provider**: Implements AI model API communication
- **Fetcher**: Dynamically fetches available models from provider
- **Transform**: Normalizes responses across providers

---

[← Back to Index](../Index.md)
