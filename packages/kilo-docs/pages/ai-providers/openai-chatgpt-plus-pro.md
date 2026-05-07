---
title: "Using ChatGPT Plus/Pro with Kilo Code"
description: "Use your ChatGPT Plus or Pro subscription with Kilo Code. Setup guide for authenticating without a separate API key."
sidebar_label: ChatGPT Plus/Pro
---

# Using ChatGPT Subscriptions With Kilo Code

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

- **Subscription Required:** You need an active ChatGPT Plus or Pro subscription. This provider won't work with free ChatGPT accounts. See [OpenAI's ChatGPT plans](https://chatgpt.com/pricing/) for more information.
- **Authentication Errors:** If you receive a CSRF or other error when completing OAuth authentication, ensure you do not have another application already listening on port 1455. You can check on Linux and Mac by using `lsof -i :1455`.
- **No API Costs:** Usage through this provider counts against your ChatGPT subscription, not separately billed API usage.
- **Sign Out:** To disconnect in VS Code, use the "Disconnect" button in the provider settings. In the CLI, run `kilo auth logout` and choose OpenAI.

## Limitations

- **You can't use arbitrary OpenAI API models.** This provider only exposes the models listed in Kilo Code's Codex model catalog.
- **You can't export/migrate your sign-in state with settings export.** OAuth tokens are stored in VS Code SecretStorage, which isn't included in Kilo Code's settings export.
