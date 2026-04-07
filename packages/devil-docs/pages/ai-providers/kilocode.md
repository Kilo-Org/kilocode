---
sidebar_label: devil Code Provider
---

# Using devil Code's Built-in Provider

devil Code provides its own built-in API provider that gives you access to the latest frontier coding models through a simple registration process. No need to manage API keys from multiple providers - just sign up and start coding.

**Website:** [https://devil.ai/](https://devil.ai/)

## Getting Started

When you sign up for devil Code, you can start immediately with free models, or top up your account for the first time to get bonus credits.

To claim your bonus credits:

1. **Sign up:** Complete the registration process
2. **First top-up:** Add funds to your account and get $20 bonus credits
3. **Start Coding:** Enjoy your $20 in free credits

## Registration Process

devil Code offers a streamlined registration that connects you directly to frontier coding models:

1. **Start Registration:** Click "Try devil Code for Free" in the extension
2. **Sign In:** Use your Google account to sign in at devil.ai
3. **Authorize VS Code:**
   - devil.ai will prompt you to open Visual Studio Code
   - For web-based IDEs, you'll copy the API key manually instead
4. **Complete Setup:** Allow VS Code to open the authorization URL when prompted

<!-- <img src="/img/setting-up/signupflow.gif" alt="Sign up and registration flow with devil Code" width="600" /> -->

## Supported Models

devil Code provides access to the latest frontier coding models through its built-in provider. The specific models available are automatically updated and managed by the devil Code service, ensuring you always have access to the most capable models for coding tasks.

## devil Gateway integration

devil Code routes requests through the devil Gateway for model access, usage tracking, and organization controls. For BYOK setup, provider routing, and full model availability, use the Gateway docs as the source of truth:

- [devil Gateway overview](/docs/gateway)
- [Models & Providers](/docs/gateway/models-and-providers)
- [Authentication & BYOK](/docs/gateway/authentication)

## Configuration in devil Code

Once you've completed the registration process, devil Code is automatically configured:

1. **Automatic Setup:** After successful registration, devil Code is ready to use immediately
2. **No API Key Management:** Your authentication is handled seamlessly through the registration process
3. **Model Selection:** Access to frontier models is provided automatically through your devil Code account

## Connected Accounts

With the devil Code provider, if you sign up with Google you can also connect other sign in accounts - like GitHub - by:

1. Go to your profile
2. Select [**Connected Accounts**](https://app.devil.ai/connected-accounts)
3. Under "Link a New account" select the type of account to link
4. Complete the OAuth authorization, and you'll see your connected accounts!

<!-- <img src="/docs/img/devil-provider/connected-accounts.png" alt="Connect account screen" width="600" /> -->

## Tips and Notes

- **Free Credits:** New users receive free credits to explore devil Code's capabilities
- **Identity Verification:** The temporary hold system ensures service reliability while preventing misuse
- **Seamless Integration:** No need to manage multiple API keys or provider configurations
- **Latest Models:** Automatic access to the most current frontier coding models
- **Support Available:** Contact [hi@devil.ai](mailto:hi@devil.ai) for questions about pricing or tokens

For detailed setup instructions, see [Setting up devil Code](/docs/getting-started/setup-authentication).
