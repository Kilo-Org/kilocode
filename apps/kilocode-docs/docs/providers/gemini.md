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

## Supported Models

Kilo Code supports the following Gemini models:

### Chat Models

- `gemini-2.5-pro-exp-03-25`
- `gemini-2.0-flash-001`
- `gemini-2.0-flash-lite-preview-02-05`
- `gemini-2.0-pro-exp-02-05`
- `gemini-2.0-flash-thinking-exp-01-21`
- `gemini-2.0-flash-thinking-exp-1219`
- `gemini-2.0-flash-exp`
- `gemini-1.5-flash-002`
- `gemini-1.5-flash-exp-0827`
- `gemini-1.5-flash-8b-exp-0827`
- `gemini-1.5-pro-002`
- `gemini-1.5-pro-exp-0827`
- `gemini-exp-1206`

### Embedding Models

- `gemini-embedding-001` - Optimized for codebase indexing and semantic search

Refer to the [Gemini documentation](https://ai.google.dev/models/gemini) for more details on each model.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Google Gemini" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Gemini API key into the "Gemini API Key" field.
4.  **Select Model:** Choose your desired Gemini model from the "Model" dropdown.

## Tips and Notes

- **Pricing:** Gemini API usage is priced based on input and output tokens. Refer to the [Gemini pricing page](https://ai.google.dev/pricing) for detailed information.
- **Codebase Indexing:** The `gemini-embedding-001` model is specifically supported for [codebase indexing](/features/codebase-indexing), providing high-quality embeddings for semantic code search.
