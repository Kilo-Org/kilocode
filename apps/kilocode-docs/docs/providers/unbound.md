---
sidebar_label: Unbound
---

# Using Unbound With Kilo Code

Kilo Code supports accessing models through [Unbound](https://getunbound.ai/), a platform that focuses on providing secure and reliable access to a variety of large language models (LLMs). Unbound acts as a gateway, allowing you to use models from providers like Anthropic and OpenAI without needing to manage multiple API keys and configurations directly.  They emphasize security and compliance features for enterprise use.

**Website:** [https://getunbound.ai/](https://getunbound.ai/)

## Creating an Account

1.  **Sign Up/Sign In:** Go to the [Unbound gateway](https://gateway.getunbound.ai).  Create an account or sign in.
2.  **Create an Application:** Go to the [Applications](https://gateway.getunbound.ai/ai-gateway-applications) page and hit the "Create Application" button.
3.  **Copy the API Key:** Copy the API key to your clipboard.

## Supported Models

Unbound allows you configure a list of supported models in your application, and Kilo Code will automatically fetch the list of available models from the Unbound API.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Unbound" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Unbound API key into the "Unbound API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

## Tips and Notes

* **Security Focus:** Unbound emphasizes security features for enterprise use. If your organization has strict security requirements for AI usage, Unbound might be a good option.
