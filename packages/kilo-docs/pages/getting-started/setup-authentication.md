---
title: "Setup & Authentication"
description: "Configure Kilo Code and connect to your AI providers"
---

# Setup & Authentication

When you install Kilo Code, you'll be prompted to sign in or create a free account. This automatically configures everything you need to get started.

## Quick Start with Kilo Account

{% tabs %}
{% tab label="VSCode" %}

The extension prompts you to sign in when you first open the sidebar. Click **Sign In** and complete the browser-based flow. The extension communicates with the CLI backend, so authentication is shared between the CLI and extension.

{% /tab %}
{% tab label="CLI" %}

Run the auth command and follow the browser-based sign-in flow:

```bash
kilo auth login
```

This may open your browser to complete authentication. Once signed in, your credentials are stored locally and used for all future sessions.

To verify your auth status:

```bash
kilo auth list
```

{% /tab %}
{% tab label="VSCode (Legacy)" %}

1. Click **"Try Kilo Code for Free"** in the extension
2. Sign in with your Google account
3. Allow VS Code to open the authorization URL

{% image src="/docs/img/signupflow.gif" alt="Sign up and registration flow with Kilo Code" /%}

That's it! You're ready to [start your first task](/docs/getting-started/quickstart).

{% /tab %}
{% /tabs %}

{% callout type="tip" title="Add Credits" %}
[Add credits to your account](https://app.kilo.ai/profile), or sign up for [Kilo Pass](https://kilo.ai/features/kilo-pass).
{% /callout %}

## Kilo Gateway API Key

If you're using the [Kilo AI Gateway](/docs/gateway/) outside of the Kilo Code extension (for example, with the Vercel AI SDK or OpenAI SDK), you'll need an API key:

1. Go to [app.kilo.ai](https://app.kilo.ai)
2. Go to **Your Profile** on your **personal account** (not in an organization)
3. Scroll to the bottom of the page
4. Copy your API key

## Using Another API Provider

If you prefer to use your own API key or existing subscription, Kilo Code supports **over 30 providers**. Here are some popular options to get started:

| Provider                                                       | Best For                            | API Key Required |
| -------------------------------------------------------------- | ----------------------------------- | ---------------- |
| [ChatGPT Plus/Pro](/docs/ai-providers/openai-chatgpt-plus-pro) | Use your existing subscription      | No               |
| [OpenRouter](/docs/ai-providers/openrouter)                    | Access multiple models with one key | Yes              |
| [Anthropic](/docs/ai-providers/anthropic)                      | Direct access to Claude models      | Yes              |
| [OpenAI](/docs/ai-providers/openai)                            | Access to GPT models                | Yes              |

{% callout type="info" title="Many More Providers Available" %}
These are just a few examples! Kilo Code supports many more providers including Google Gemini, DeepSeek, Mistral, Ollama (for local models), AWS Bedrock, Google Vertex, and more. See the complete list at [AI Providers](/docs/ai-providers/).
{% /callout %}

### ChatGPT Plus/Pro Subscription

Already have a ChatGPT subscription? You can use it with Kilo Code through the [OpenAI ChatGPT provider](/docs/ai-providers/openai-chatgpt-plus-pro)—no API key needed.

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

{% tabs %}
{% tab label="VSCode" %}

1. Open the Kilo Code sidebar in VS Code
2. Click the gear icon ({% codicon name="gear" /%}) to open **Settings**
3. Go to the **Providers** tab
4. Select your provider and enter your API key
5. Choose your model

You can also use `kilo auth login` for providers that support OAuth (like GitHub Copilot). The extension reads from the same underlying config files as the CLI, so provider settings are shared.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or use `kilo auth login` for providers that support OAuth (like GitHub Copilot).

To set a default model:

```jsonc
{
  "model": "anthropic/claude-sonnet-4-20250514",
}
```

{% /tab %}
{% tab label="VSCode (Legacy)" %}

1. Click the {% kilo-code-icon /%} icon in the VS Code sidebar
2. Select your API provider from the dropdown
3. Paste your API key
4. Choose your model
5. Click **"Let's go!"**

{% /tab %}
{% /tabs %}

{% callout type="info" title="Need Help?" %}
Reach out to our [support team](mailto:hi@kilo.ai) or join our [Discord community](https://kilo.ai/discord).
{% /callout %}
