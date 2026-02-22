---
sidebar_label: Google Gemini
---

# Using Google Gemini With Kilo Code

Kilo Code supports Google's Gemini family of models through the Google AI Gemini API.

**Website:** [https://ai.google.dev/](https://ai.google.dev/)

## Getting an API Key

1.  **Go to Google AI Studio:** Navigate to [https://ai.google.dev/](https://ai.google.dev/).
2.  **Sign In:** Sign in with your Google account.
3.  **Create API Key:** Click on "Create API key" in the left-hand menu.
4.  **Copy API Key:** Copy the generated API key.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "Google Gemini" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Gemini API key into the "Gemini API Key" field.
4.  **Select Model:** Choose your desired Gemini model from the "Model" dropdown.

## Using Gemini CLI with Kilo Code

If you're already using Gemini CLI, note that Kilo Code does not currently reuse Gemini CLI auth/session state directly.

To use Gemini models in Kilo Code:

1. Keep Gemini CLI for terminal workflows, if desired.
2. Configure Kilo Code separately with the **Google Gemini** provider and a Gemini API key.
3. If you prefer Google Cloud auth/quotas, use [Vertex AI](/docs/ai-providers/vertex) instead.

## Tips and Notes

- **Pricing:** Gemini API usage is priced based on input and output tokens. Refer to the [Gemini pricing page](https://ai.google.dev/pricing) for detailed information.
- **Codebase Indexing:** The `gemini-embedding-001` model is specifically supported for [codebase indexing](/docs/customize/context/codebase-indexing), providing high-quality embeddings for semantic code search.
