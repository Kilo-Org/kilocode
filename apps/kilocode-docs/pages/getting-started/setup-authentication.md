---
title: "Setup & Authentication"
description: "Configure Kilo Code and connect to your AI providers"
---

# Setup & Authentication

When you install Kilo Code, you'll be prompted to sign in or create a free account. This automatically configures everything you need to get started.

## Quick Start with Kilo Account

1. Click **"Try Kilo Code for Free"** in the extension
2. Sign in with your Google account
3. Allow VS Code to open the authorization URL

{% image src="/docs/img/signupflow.gif" alt="Sign up and registration flow with Kilo Code" /%}

That's it! You're ready to [start your first task](/getting-started/quickstart).

{% callout type="tip" title="Bonus Credits" %}
[Add credits to your account](https://app.kilo.ai/profile) and get $20 bonus credits, or sign up for [Kilo Pass](https://kilo.ai/features/kilo-pass).
{% /callout %}

## Using Another API Provider

If you prefer to use your own API key or existing subscription, Kilo Code supports **over 30 providers**. Here are some popular options to get started:

| Provider                                                  | Best For                            | API Key Required |
| --------------------------------------------------------- | ----------------------------------- | ---------------- |
| [ChatGPT Plus/Pro](/ai-providers/openai-chatgpt-plus-pro) | Use your existing subscription      | No               |
| [OpenRouter](/ai-providers/openrouter)                    | Access multiple models with one key | Yes              |
| [Anthropic](/ai-providers/anthropic)                      | Direct access to Claude models      | Yes              |
| [OpenAI](/ai-providers/openai)                            | Access to GPT models                | Yes              |

{% callout type="info" title="Many More Providers Available" %}
These are just a few examples! Kilo Code supports many more providers including Google Gemini, DeepSeek, Mistral, Ollama (for local models), AWS Bedrock, Google Vertex, and more. See the complete list at [AI Providers](/ai-providers/).
{% /callout %}

### ChatGPT Plus/Pro Subscription

Already have a ChatGPT subscription? You can use it with Kilo Code through the [OpenAI ChatGPT provider](/providers/openai-chatgpt-plus-pro)—no API key needed.

### OpenRouter

1. Go to [openrouter.ai](https://openrouter.ai/) and sign in
2. Navigate to [API keys](https://openrouter.ai/keys) and create a new key
3. Copy your API key

{% image src="/docs/img/connecting-api-provider/connecting-api-provider-4.png" alt="OpenRouter API keys page" width="600px" caption="Create and copy your OpenRouter API key" /%}

### Anthropic

1. Go to [console.anthropic.com](https://console.anthropic.com/) and sign in
2. Navigate to [API keys](https://console.anthropic.com/settings/keys) and create a new key
3. Copy your API key immediately—it won't be shown again

{% image src="/docs/img/connecting-api-provider/connecting-api-provider-5.png" alt="Anthropic console API Keys section" width="600px" caption="Copy your Anthropic API key immediately after creation" /%}

### OpenAI

1. Go to [platform.openai.com](https://platform.openai.com/) and sign in
2. Navigate to [API keys](https://platform.openai.com/api-keys) and create a new key
3. Copy your API key immediately—it won't be shown again

{% image src="/docs/img/connecting-api-provider/connecting-api-provider-6.png" alt="OpenAI API keys page" width="600px" caption="Copy your OpenAI API key immediately after creation" /%}

### Configuring Your Provider

1. Click the {% kilo-code-icon /%} icon in the VS Code sidebar
2. Select your API provider from the dropdown
3. Paste your API key
4. Choose your model:
5. Click **"Let's go!"**

{% callout type="info" title="Need Help?" %}
Reach out to our [support team](mailto:hi@kilo.ai) or join our [Discord community](https://kilo.ai/discord).
{% /callout %}
