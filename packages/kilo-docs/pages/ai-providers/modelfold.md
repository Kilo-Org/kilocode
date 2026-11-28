---
title: "Using ModelFold with Kilo Code"
description: "Set up ModelFold as a custom OpenAI-compatible provider and select a chat model available to your account."
sidebar_label: ModelFold
---

# Use ModelFold with Kilo Code

ModelFold provides access to chat models through a single API. To use its Chat Completions endpoint in Kilo Code, add a **custom provider**. You won't find a built-in entry named ModelFold.

## Connect in VS Code

1. Sign in to [ModelFold](https://modelfold.ai), open **API Keys**, and create a key. See the [authentication guide](https://modelfold.ai/docs/guide/authentication) for details.
2. In Kilo Code, open **Settings → Providers → Custom provider**. Enter `modelfold` as the **Provider ID** and `ModelFold` as the **Display name**.
3. Select **OpenAI Compatible** for **Provider API**. Enter `https://modelfold.ai/v1` as the **Base URL** and paste your key in **API key**. Use the base URL as shown: Kilo appends the model-list and chat paths.
4. Click **Fetch models** and select a chat model available to your account, such as `deepseek-v4-flash` if listed. Click **Submit**, then select the model in Kilo's model picker.

If the list is empty, check the key and base URL before entering a model ID manually. ModelFold's Anthropic Messages and Responses endpoints use different URLs; don't copy their model lists into this configuration. A listed model doesn't necessarily support tool calls. Check the model's capabilities in the [ModelFold documentation](https://modelfold.ai/docs/) before using it for an agent task.

For CLI configuration, see the **CLI** tab in [OpenAI-compatible providers](/docs/ai-providers/openai-compatible). Use the same base URL and model ID, and supply your key through an environment variable rather than putting it in a project file.
