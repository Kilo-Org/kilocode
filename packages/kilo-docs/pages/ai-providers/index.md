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
- **[DeepSeek](/docs/ai-providers/deepseek)** - DeepSeek V3, R1
- **[Mistral](/docs/ai-providers/mistral)** - Mistral Large, Codestral
- **[xAI](/docs/ai-providers/xai)** - Grok models
- **[Moonshot](/docs/ai-providers/moonshot)** - Kimi model family
- **[MiniMax](/docs/ai-providers/minimax)** - MiniMax chat models
- **[Groq](/docs/ai-providers/groq)** - High-speed inference
- **[Cerebras](/docs/ai-providers/cerebras)** - Fast cloud inference
- **[Fireworks](/docs/ai-providers/fireworks)** - Multi-model inference platform
- **[Chutes AI](/docs/ai-providers/chutes-ai)** - Managed model routing
- **[OVHcloud](/docs/ai-providers/ovhcloud)** - Managed AI endpoints
- **[Inception](/docs/ai-providers/inception)** - Additional hosted model access

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
- **[ZenMux](/docs/ai-providers/zenmux)** - Unified multi-provider gateway
- **[Vercel AI Gateway](/docs/ai-providers/vercel-ai-gateway)** - OpenAI-compatible gateway
- **[Unbound](/docs/ai-providers/unbound)** - Gateway with enterprise controls
- **[Virtual Quota Fallback](/docs/ai-providers/virtual-quota-fallback)** - Automatic provider failover by quota

## Choosing a Provider

| Priority        | Recommended Provider                                 |
| --------------- | ---------------------------------------------------- |
| Ease of use     | [Kilo Code (built-in)](/docs/ai-providers/kilocode) |
| Best value      | Zhipu AI or Mistral                                  |
| Privacy/Offline | Ollama or LM Studio                                  |
| Enterprise      | AWS Bedrock or Google Vertex                         |

## Why Use Multiple Providers?

- **Cost** - Compare pricing across providers for different tasks
- **Reliability** - Backup options when a provider has outages
- **Models** - Access exclusive or specialized models
- **Regional** - Better latency in certain locations

{% callout type="note" %}
All API keys use VS Code's Secret Storage - never stored in plain text.
{% /callout %}

## Additional Integrations

- **[Claude Code](/docs/ai-providers/claude-code)** - Use Anthropic's CLI-based provider mode
- **[OpenAI ChatGPT Plus/Pro](/docs/ai-providers/openai-chatgpt-plus-pro)** - Use ChatGPT account auth flow
- **[VS Code Language Models](/docs/ai-providers/vscode-lm)** - Use models exposed by VS Code
- **[SAP AI Core](/docs/ai-providers/sap-ai-core)** - Enterprise SAP integration
- **[Human Relay](/docs/ai-providers/human-relay)** - Human-in-the-loop workflow provider
- **[v0](/docs/ai-providers/v0)** - OpenAI-compatible v0 access

## Next Steps

- **New to Kilo Code?** Start with the [Kilo Code provider](/docs/ai-providers/kilocode) - no setup required
- **Have an API key?** Jump to your provider's page for configuration instructions
- **Want to compare?** Check out [Model Selection](/docs/code-with-ai/agents/model-selection) for guidance on choosing models
