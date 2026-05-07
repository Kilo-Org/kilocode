---
title: "Using Unbound with Kilo Code"
description: "Access Claude, GPT, and other leading models through the Unbound proxy in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: Unbound
---

# Using Unbound With Kilo Code

Kilo Code supports accessing models through [Unbound](https://getunbound.ai/), a platform that focuses on providing secure and reliable access to a variety of large language models (LLMs). Unbound acts as a gateway, allowing you to use models from providers like Anthropic and OpenAI without needing to manage multiple API keys and configurations directly. They emphasize security and compliance features for enterprise use.

**Website:** [https://getunbound.ai/](https://getunbound.ai/)

## Creating an Account

1.  **Sign Up/Sign In:** Go to the [Unbound gateway](https://gateway.getunbound.ai). Create an account or sign in.
2.  **Create an Application:** Go to the [Connect](https://gateway.getunbound.ai/connect) page and select "Kilo Code".
3.  **Copy the API Key:** Copy the API key to your clipboard.

## Supported Models

Unbound allows you configure a list of supported models in your application, and Kilo Code will automatically fetch the list of available models from the Unbound API.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "Unbound" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Unbound API key into the "Unbound API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Unbound and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

{% callout type="warning" %}
Unbound is not yet available as a CLI provider. Check the [Kilo Code releases](https://github.com/Kilo-Org/kilocode/releases) for updates on provider support.
{% /callout %}

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Security Focus:** Unbound emphasizes security features for enterprise use. If your organization has strict security requirements for AI usage, Unbound might be a good option.
