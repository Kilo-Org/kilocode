---
sidebar_label: Kilo Code Provider
---

# Using Kilo Code's Built-in Provider

Kilo Code provides its own built-in API provider that gives you access to the latest frontier coding models through a simple registration process. No need to manage API keys from multiple providers - just sign up and start coding.

**Website:** [https://kilo.ai/](https://kilo.ai/)

## Getting Started

When you sign up for Kilo Code, you can start immediately with free models, or top up your account for the first time to get bonus credits.

To claim your bonus credits:

1. **Sign up:** Complete the registration process
2. **First top-up:** Add funds to your account and get $20 bonus credits
3. **Start Coding:** Enjoy your $20 in free credits

## Registration Process

Kilo Code offers a streamlined registration that connects you directly to frontier coding models:

1. **Start Registration:** Click "Try Kilo Code for Free" in the extension
2. **Sign In:** Use your Google account to sign in at kilo.ai
3. **Authorize VS Code:**
    - kilo.ai will prompt you to open Visual Studio Code
    - For web-based IDEs, you'll copy the API key manually instead
4. **Complete Setup:** Allow VS Code to open the authorization URL when prompted

<!-- <img src="/img/setting-up/signupflow.gif" alt="Sign up and registration flow with Kilo Code" width="600" /> -->

## Supported Models

Kilo Code provides access to the latest frontier coding models through its built-in provider. The specific models available are automatically updated and managed by the Kilo Code service, ensuring you always have access to the most capable models for coding tasks.

## BYOK support

You can also bring your own key (BYOK) to the Kilo Gateway. We currently support the following providers: Anthropic, OpenAI, Google AI Studio, MiniMax, Mistral AI, xAI, and Z.ai.

You can access the BYOK section of the Kilo Gateway [here](https://app.kilo.ai/byok).

## Configuration in Kilo Code

Once you've completed the registration process, Kilo Code is automatically configured:

1. **Automatic Setup:** After successful registration, Kilo Code is ready to use immediately
2. **No API Key Management:** Your authentication is handled seamlessly through the registration process
3. **Model Selection:** Access to frontier models is provided automatically through your Kilo Code account

### Provider Routing

Kilo Code can route to many different inference providers. For personal accounts, provider routing behavior can be controlled in the API Provider settings under Provider Routing.

#### Provider Sorting

- Default provider sorting: at time of writing equivalent to prefer providers with lower price
- Prefer providers with lower price
- Prefer providers with higher throughput (i.e. more tokens per seconds)
- Prefer providers with lower latency (i.e. shorter time to first token)
- A specific provider preference can also be chosen.

#### Data Policy

- Allow prompt training (free only): providers that may train on your prompts or completions are only allowed for free models.
- Allow prompt training: providers that may train on your prompts or completions are allowed.
- Deny prompt training: providers that may train on your prompts or completions are not allowed.
- Zero data retention: only providers with a strict zero data retention policy are allowed. This option is not recommended, as it will disable many popular providers, such as Anthropic and OpenAI.

## Connected Accounts

With the Kilo Code provider, if you sign up with Google you can also connect other sign in accounts - like GitHub - by:

1. Go to your profile
2. Select [**Connected Accounts**](https://app.kilo.ai/connected-accounts)
3. Under "Link a New account" select the type of account to link
4. Complete the OAuth authorization, and you'll see your connected accounts!

<img src="/docs/img/kilo-provider/connected-accounts.png" alt="Connect account screen" width="600" />

## Tips and Notes

- **Free Credits:** New users receive free credits to explore Kilo Code's capabilities
- **Identity Verification:** The temporary hold system ensures service reliability while preventing misuse
- **Seamless Integration:** No need to manage multiple API keys or provider configurations
- **Latest Models:** Automatic access to the most current frontier coding models
- **Support Available:** Contact [hi@kilo.ai](mailto:hi@kilo.ai) for questions about pricing or tokens

For detailed setup instructions, see [Setting up Kilo Code](/docs/getting-started/setting-up).
