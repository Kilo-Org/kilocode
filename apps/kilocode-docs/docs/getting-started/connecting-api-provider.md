---
sidebar_label: Connecting To A Provider
---

# Connecting an AI Provider

Kilo Code requires an API key from an AI model provider to function.

We recommend these options for accessing the powerful **Claude 4 Sonnet** model:

- **Kilo Gateway (Recommended):** Provides access to all of the models available through OpenRouter with competitive pricing and free credits to get started. [View pricing](https://kilo.ai/pricing)
- **OpenRouter:** Provides access to multiple AI models through a single API key. [View pricing](https://openrouter.ai/models?order=pricing-low-to-high).
- **Anthropic:** Direct access to Claude models. Requires API access approval and may have [rate limits depending on your tier](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier). See [Anthropic's pricing page](https://www.anthropic.com/pricing#anthropic-api) for details.

## Using the Kilo Code Provider

By default when you install Kilo Code the extension, you'll be prompted to sign in or create an account in the [Kilo Code Provider](/providers/kilocode).

That will walk you through the account setup and _automatically_ configure Kilo Code properly to get you started. If you'd rather use another provider, you'll need to manually get your API key as described below.

## Using another API Provider

_Coming soon to Kilo Code Teams and Enterprise!_

### Getting Your API Key

#### Option 1: LLM Routers

LLM routers let you access multiple AI models with one API key, simplifying cost management and switching between models. They often offer [competitive pricing](https://openrouter.ai/models?order=pricing-low-to-high) compared to direct providers.

##### OpenRouter

1. Go to [openrouter.ai](https://openrouter.ai/)
2. Sign in with your Google or GitHub account
3. Navigate to the [API keys page](https://openrouter.ai/keys) and create a new key
4. Copy your API key - you'll need this for Kilo Code setup

<img src="/docs/img/connecting-api-provider/connecting-api-provider-4.png" alt="OpenRouter API keys page" width="600" />

_OpenRouter dashboard with "Create key" button. Name your key and copy it after creation._

##### Requesty

1. Go to [requesty.ai](https://requesty.ai/)
2. Sign in with your Google account or email
3. Navigate to the [API management page](https://app.requesty.ai/manage-api) and create a new key
4. **Important:** Copy your API key immediately as it won't be displayed again

<img src="/docs/img/connecting-api-provider/connecting-api-provider-7.png" alt="Requesty API management page" width="600" />

_Requesty API management page with "Create API Key" button. Copy your key immediately - it's shown only once._

#### Option 2: Direct Providers

For direct access to specific models from their original providers, with full access to their features and capabilities:

##### Anthropic

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up for an account or log in
3. Navigate to the [API keys section](https://console.anthropic.com/settings/keys) and create a new key
4. **Important:** Copy your API key immediately as it won't be displayed again

<img src="/docs/img/connecting-api-provider/connecting-api-provider-5.png" alt="Anthropic console API Keys section" width="600" />

_Anthropic console API Keys section with "Create key" button. Name your key, set expiration, and copy it immediately._

##### OpenAI

1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign up for an account or log in
3. Navigate to the [API keys section](https://platform.openai.com/api-keys) and create a new key
4. **Important:** Copy your API key immediately as it won't be displayed again

<img src="/docs/img/connecting-api-provider/connecting-api-provider-6.png" alt="OpenAI API keys page" width="600" />

_OpenAI platform with "Create new secret key" button. Name your key and copy it immediately after creation._

### Configuring the Provider in Kilo Code

Once you have your API key:

1. Open the Kilo Code sidebar by clicking the Kilo Code icon (<img src="/docs/img/kilo-v1.svg" width="12" />) in the VS Code Side Bar
2. In the welcome screen, select your API provider from the dropdown
3. Paste your API key into the appropriate field
4. Select your model:
    - For **OpenRouter**: select `anthropic/claude-3.7-sonnet` ([model details](https://openrouter.ai/anthropic/claude-3.7-sonnet))
    - For **Anthropic**: select `claude-3-7-sonnet-20250219` ([model details](https://www.anthropic.com/pricing#anthropic-api))
5. Click "Let's go!" to save your settings and start using Kilo Code
