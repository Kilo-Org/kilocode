---
title: "AI Providers"
description: "Configure and connect different AI model providers to Kilo Code"
---

# AI Providers

Kilo Code supports a wide variety of AI providers, giving you flexibility in how you power your AI-assisted development workflow. Choose from cloud providers, local models, or AI gateways based on your needs.

## Getting Started

The fastest way to get started is with **Kilo Code's built-in provider**, which requires no configuration. Simply sign in and start coding.

For users who want to use their own API keys or need specific models, we support over 30 providers.

## Provider Categories

### Cloud Providers

Major AI companies offering powerful models via API:

- **[Anthropic](/docs/ai-providers/anthropic)** - Claude models (Claude 4, Claude 3.5 Sonnet, etc.)
- **[OpenAI](/docs/ai-providers/openai)** - GPT-4, GPT-4o, o1, and more
- **[Google Gemini](/docs/ai-providers/gemini)** - Gemini Pro, Gemini Ultra
- **[Google Vertex AI](/docs/ai-providers/vertex)** - Google Cloud-hosted Gemini and partner models
- **[AWS Bedrock](/docs/ai-providers/bedrock)** - AWS-hosted foundation models
- **[Alibaba Cloud](/docs/ai-providers/alibaba)** - DashScope and Qwen models through Model Studio
- **[Cloudflare](/docs/ai-providers/cloudflare)** - Workers AI and Cloudflare AI Gateway
- **[DeepSeek](/docs/ai-providers/deepseek)** - DeepSeek V3., R1
- **[Mistral](/docs/ai-providers/mistral)** - Mistral Large, Codestral

### Local & Self-Hosted

Run models on your own hardware for privacy and offline use:

- **[Ollama](/docs/ai-providers/ollama)** - Easy local model management
- **[LM Studio](/docs/ai-providers/lmstudio)** - Desktop app for local models
- **[OpenAI Compatible](/docs/ai-providers/openai-compatible)** - Any OpenAI-compatible endpoint

### AI Gateways

Route requests through unified APIs with additional features:

- **[OpenRouter](/docs/ai-providers/openrouter)** - Access multiple providers through one API
- **[Glama](/docs/ai-providers/glama)** - Enterprise AI gateway
- **[Requesty](/docs/ai-providers/requesty)** - Smart routing and fallbacks
- **[Cloudflare AI Gateway](/docs/ai-providers/cloudflare)** - Route providers through your Cloudflare account

## Choosing a Provider

| Priority | Recommended Provider |
|---|---|
| Ease of use | [Kilo Code (built-in)](/docs/ai-providers/kilocode) |
| Best value | Zhipu AI or Mistral |
| Privacy/Offline | Ollama or LM Studio |
| Enterprise | AWS Bedrock or Google Vertex |

## Why Use Multiple Providers?

- **Cost** - Compare pricing across providers for different tasks
- **Reliability** - Backup options when a provider has outages
- **Models** - Access exclusive or specialized models
- **Regional** - Better latency in certain locations

{% callout type="note" %}
In the **VSCode (Legacy)** version, API keys use VS Code's Secret Storage. In the current **VSCode & CLI** version, keys are set via environment variables or referenced in `kilo.json` config files. See individual provider pages for setup instructions for each platform.
{% /callout %}

## Disabling Built-in Providers

You can prevent specific providers from loading using `disabled_providers` in your `kilo.json` (or `kilo.jsonc`). This is useful to hide models from built-in or detected providers that you don't intend to use.

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "disabled_providers": ["kilo", "openai"]
}
```

To allow only specific providers and disable everything else, use `enabled_providers` instead:

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "enabled_providers": ["anthropic"]
}
```

Both fields accept provider IDs — the lowercase identifier used in the `provider/model` format (e.g. `kilo`, `anthropic`, `openai`, `google`, `groq`).

## Next Steps

- **New to Kilo Code?** Start with the [Kilo Code provider](/docs/ai-providers/kilocode) - no setup required
- **Have an API key?** Jump to your provider's page for configuration instructions
- **Want to compare?** Check out [Model Selection](/docs/code-with-ai/agents/model-selection) for guidance on choosing models
