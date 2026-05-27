---
title: "Using ChatGPT Plus/Pro with Kilo Code"
description: "Use your ChatGPT Plus or Pro subscription with Kilo Code. Flat-rate access to OpenAI Codex models with OAuth login — no separate API key required."
sidebar_label: ChatGPT Plus/Pro
---

# Using ChatGPT Subscriptions With Kilo Code

If you already pay for ChatGPT Plus or Pro, you can use that subscription to run OpenAI's top coding models directly inside Kilo Code — with no extra API charges beyond your subscription.

## Why use your ChatGPT subscription?

- **Flat-rate access to OpenAI models:** Your subscription covers usage without pay-as-you-go API costs.
- **OAuth login — no API keys:** Click "Sign in to OpenAI Codex," authenticate in your browser, and you're done.
- **Full agentic workflows:** Generate, refactor, debug, edit files, and run terminal commands inside Kilo Code.
- **Multiple AI modes:** Switch between Code, Plan, Debug, and Ask modes for different tasks.

{% callout type="note" %}
Your ChatGPT subscription works with Kilo Code's core functionality (VS Code extension and CLI), but does **not** include cloud features such as Cloud Agents, Kilo Deploy, or KiloClaw. To use GPT models in those features, use the [Kilo Gateway](/docs/gateway).
{% /callout %}

## Setup

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. Open Kilo Code settings (click the gear icon {% codicon name="gear" /%} in the Kilo Code panel).
2. In **API Provider**, select **OpenAI – ChatGPT Plus/Pro**.
3. Click **Sign in to OpenAI Codex**.
4. Finish the sign-in flow in your browser.
5. Back in Kilo Code settings, pick a model from the dropdown.
6. Save.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab. ChatGPT Plus/Pro uses OAuth authentication — follow the sign-in flow to connect your ChatGPT subscription.

If OpenAI is already connected from an API key, environment variable, or `kilo.json` config, you can still sign in with ChatGPT from the OpenAI provider row. Kilo Code uses the ChatGPT sign-in for Codex models until you disconnect it, then falls back to your existing OpenAI API configuration.

{% /tab %}
{% tab label="CLI" %}

Run the auth command and follow the ChatGPT Plus/Pro sign-in flow:

```bash
kilo auth login --provider codex
```

You can also use `--provider openai`. If you already have `OPENAI_API_KEY` or OpenAI config set, ChatGPT OAuth takes priority for Codex models until you log out of the OpenAI provider.

Then set your default model to one of the OpenAI Codex models available in Kilo Code:

```jsonc
{
  "model": "openai/gpt-5.1-codex",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Subscription Required:** You need an active ChatGPT Plus or Pro subscription. This provider won't work with free ChatGPT accounts. [Codex is included](https://developers.openai.com/codex/pricing/) in ChatGPT Plus, Pro, Business, Edu, and Enterprise plans. See [OpenAI's ChatGPT plans](https://chatgpt.com/pricing/) for more information.
- **No API Costs:** Usage through this provider counts against your ChatGPT subscription, not separately billed API usage.
- **Authentication Errors:** If you receive a CSRF or other error when completing OAuth authentication, ensure you do not have another application already listening on port 1455. You can check on Linux and Mac by using `lsof -i :1455`.
- **Sign Out:** To disconnect in VS Code, use the "Disconnect" button in the provider settings. In the CLI, run `kilo auth logout` and choose OpenAI.
- **Switching providers:** You can switch to Claude, Gemini, or local models at any time — this provider is optional.

## Limitations

- **Codex catalog models only.** This provider only exposes the models listed in Kilo Code's Codex model catalog. It does not give access to every model available through the OpenAI API.
- **OAuth tokens can't be exported with settings.** Tokens are stored in VS Code SecretStorage, which isn't included in Kilo Code's settings export.
- **Cloud features not included.** Cloud Agents, Kilo Deploy, and KiloClaw require the [Kilo Gateway](/docs/gateway).

## FAQ

**Do I need a separate API key?**
No — just sign in with OAuth using your ChatGPT subscription.

**Which ChatGPT plans include Codex access?**
ChatGPT Plus, Pro, Business, Edu, and Enterprise. Free accounts are not supported.

**How is usage billed?**
Usage counts against your ChatGPT subscription limits — there are no separate API charges.

**Can I still switch to other AI providers?**
Yes. Use OpenAI when it fits and switch to Claude, Gemini, or any local model at any time.

**Can I use my ChatGPT subscription in KiloClaw?**
No. For KiloClaw and other cloud features, use GPT models through the [Kilo Gateway](/docs/gateway), which gives access to 500+ models including the latest GPT releases.
