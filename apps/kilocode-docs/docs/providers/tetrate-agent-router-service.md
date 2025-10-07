---
sidebar_label: Tetrate Agent Router Service
---

# Using Tetrate Agent Router Service With Kilo Code

Tetrate Agent Router Service is an AI platform that provides access to various language models through a unified API.

**Website:** [https://router.tetrate.ai/](https://router.tetrate.ai/)

## Getting an API Key

Tetrate Agent Router Service uses OAuth 2.0 with PKCE (Proof Key for Code Exchange) for secure authentication:

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Tetrate Agent Router Service" from the "API Provider" dropdown.
3.  **Click "Get Tetrate Agent Router Service API Key":** This will open the authentication page in your browser.
4.  **Sign Up/Sign In:** Create an account or sign in at the Tetrate website.
5.  **Authorize Kilo Code:** Grant Kilo Code permission to access Tetrate Agent Router Service on your behalf.
6.  **Automatic Setup:** After successful authorization, your API key will be automatically configured in Kilo Code.

Alternatively, if you already have an API key, you can manually enter it in the settings.

## Supported Models

Tetrate Agent Router Service supports various language models. Kilo Code automatically fetches the list of available models from the API. Refer to the Tetrate documentation for the complete and up-to-date list of supported models.

## Configuration in Kilo Code

After obtaining your API key through the OAuth flow (or manually):

1.  **Select Model:** Choose your desired model from the "Model" dropdown.
2.  **(Optional) Custom Base URL:** If you need to use a custom base URL for the API, check "Use custom base URL" and enter the URL. Most users won't need to adjust this.

## Manual API Key Configuration

If you prefer to manually configure your API key:

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Tetrate Agent Router Service" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your API key into the "Tetrate Agent Router Service API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

## Tips and Notes

- **OAuth Security:** Tetrate Agent Router Service uses PKCE (Proof Key for Code Exchange) for OAuth authentication, providing enhanced security without requiring client secrets.
- **Model Selection:** Tetrate Agent Router Service offers various models with different capabilities. Choose the model that best fits your use case.
- **Pricing:** Refer to the Tetrate pricing page for the latest pricing information on different models.
- **Rate Limits:** Be aware of any rate limits that may apply to your account tier.
- **Automatic Key Management:** When using OAuth authentication, your API key is securely stored and managed automatically by Kilo Code.
