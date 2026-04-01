---
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

{% /tab %}
{% tab label="CLI" %}

ChatGPT Plus/Pro uses OAuth authentication, which is only available in the VS Code extension. For the CLI, use the [OpenAI API provider](/docs/ai-providers/openai) with an API key instead:

```bash
export OPENAI_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "openai": {
      "env": ["OPENAI_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "openai/gpt-4.1",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Subscription Required:** You need an active ChatGPT Plus or Pro subscription. This provider won't work with free ChatGPT accounts. See [OpenAI's ChatGPT plans](https://openai.com/chatgpt/pricing) for more information.
- **Authentication Errors:** If you receive a CSRF or other error when completing OAuth authentication, ensure you do not have another application already listening on port 1455. You can check on Linux and Mac by using `lsof -i :1455`.
- **No API Costs:** Usage through this provider counts against your ChatGPT subscription, not separately billed API usage.
- **Sign Out:** To disconnect, use the "Sign Out" button in the provider settings.

## Limitations

- **You can't use arbitrary OpenAI API models.** This provider only exposes the models listed in Kilo Code's Codex model catalog.
- **You can't export/migrate your sign-in state with settings export.** OAuth tokens are stored in VS Code SecretStorage, which isn't included in Kilo Code's settings export.
