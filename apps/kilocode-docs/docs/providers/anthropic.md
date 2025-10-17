---
sidebar_label: Anthropic
---

# Using Anthropic With Kilo Code

Anthropic is an AI safety and research company that builds reliable, interpretable, and steerable AI systems.  Their Claude models are known for their strong reasoning abilities, helpfulness, and honesty.

**Website:** [https://www.anthropic.com/](https://www.anthropic.com/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [Anthropic Console](https://console.anthropic.com/). Create an account or sign in.
2.  **Navigate to API Keys:**  Go to the [API keys](https://console.anthropic.com/settings/keys) section.
3.  **Create a Key:** Click "Create Key". Give your key a descriptive name (e.g., "Kilo Code").
4.  **Copy the Key:**  **Important:** Copy the API key *immediately*.  You will not be able to see it again.  Store it securely.

## Supported Models

Kilo Code supports the following Anthropic Claude models:

*   `claude-3-7-sonnet-20250219` (Recommended)
*   `claude-3-7-sonnet-20250219:thinking` (Extended Thinking variant)
*   `claude-3-5-sonnet-20241022`
*   `claude-3-5-haiku-20241022`
*   `claude-3-opus-20240229`
*   `claude-3-haiku-20240307`

See [Anthropic's Model Documentation](https://docs.anthropic.com/en/docs/about-claude/models) for more details on each model's capabilities.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Anthropic" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Anthropic API key into the "Anthropic API Key" field.
4.  **Select Model:** Choose your desired Claude model from the "Model" dropdown.
5.  **(Optional) Custom Base URL:** If you need to use a custom base URL for the Anthropic API, check "Use custom base URL" and enter the URL. Most people won't need to adjust this.

## Tips and Notes

*   **Prompt Caching:** Claude 3 models support [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), which can significantly reduce costs and latency for repeated prompts.
*   **Context Window:** Claude models have large context windows (200,000 tokens), allowing you to include a significant amount of code and context in your prompts.
*   **Pricing:** Refer to the [Anthropic Pricing](https://www.anthropic.com/pricing) page for the latest pricing information.
*   **Rate Limits:** Anthropic has strict rate limits based on [usage tiers](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier). If you're repeatedly hitting rate limits, consider contacting Anthropic sales or accessing Claude through a different provider like [OpenRouter](/providers/openrouter) or [Requesty](/providers/requesty).
