---
sidebar_label: ChatGPT Plus/Pro
---

# Using ChatGPT Subscriptions With Kilo Code

1. Open Kilo Code settings (click the gear icon {% codicon name="gear" /%} in the Kilo Code panel).
2. In **API Provider**, select **OpenAI – ChatGPT Plus/Pro**.
3. Click **Sign in to OpenAI Codex**.
4. Finish the sign-in flow in your browser.
5. Back in Kilo Code settings, pick a model from the dropdown.
6. Save.

## Tips and Notes

- **Subscription Required:** You need an active ChatGPT Plus or Pro subscription. This provider won't work with free ChatGPT accounts. See [OpenAI's ChatGPT plans](https://openai.com/chatgpt/pricing) for more information.
- **Authentication Errors:** If you receive a CSRF or other error when completing OAuth authentication, ensure you do not have another application already listening on port 1455. You can check on Linux and Mac by using `lsof -i :1455`.
- **No API Costs:** Usage through this provider counts against your ChatGPT subscription, not separately billed API usage.
- **Sign Out:** To disconnect, use the "Sign Out" button in the provider settings.

## Limitations

- **You can't use arbitrary OpenAI API models.** This provider only exposes the models listed in Kilo Code's Codex model catalog.
- **You can't export/migrate your sign-in state with settings export.** OAuth tokens are stored in VS Code SecretStorage, which isn't included in Kilo Code's settings export.
