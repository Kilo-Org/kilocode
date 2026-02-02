---
sidebar_label: SAP AI Core
---

# Using SAP AI Core With Kilo Code

Kilo Code supports accessing models through SAP AI Core, a service in the SAP Business Technology Platform that lets you efficiently run AI scenarios in a standardized, scalable, and hyperscaler-agnostic manner.

**Website:** [https://help.sap.com/docs/sap-ai-core](https://help.sap.com/docs/sap-ai-core)

## Prerequisites

- **SAP BTP Account:** You need an active SAP Business Technology Platform account.
- **SAP AI Core Service:** You must have access to the SAP AI Core service in your BTP subaccount.
- **Service Instance:** Create a service instance of SAP AI Core with appropriate service plan.
- **Service Key:** Generate a service key for your SAP AI Core service instance to obtain the required credentials.

## Getting Credentials

To use SAP AI Core with Kilo Code, you'll need to create a service key for your SAP AI Core service instance:

1. **In SAP BTP Cockpit:**

    - Navigate to your subaccount
    - Go to "Services" → "Instances and Subscriptions"
    - Find your SAP AI Core service instance
    - Create a new service key

2. **Service Key Information:**
   The service key will contain the following information you'll need:
    - **Client ID:** OAuth2 client identifier
    - **Client Secret:** OAuth2 client secret
    - **Auth URL:** OAuth2 authentication endpoint
    - **Base URL:** SAP AI Core API base URL
    - **Resource Group:** (Optional) Specify a resource group, defaults to "default"

## Operating Modes

SAP AI Core provider supports two operating modes:

### Foundation Models Mode (Default)

- Uses foundation models that require active deployments
- Currently, supports **OpenAI models only** due to SAP AI Core SDK limitations
- Requires you to have running deployments for the models you want to use
- Models must have deployments in "RUNNING" status to be selectable

### Orchestration Mode

- Uses SAP AI Core's orchestration capabilities
- Supports models from multiple providers: **Amazon, Anthropic, Google, OpenAI, and Mistral AI**
- Does not require separate deployments
- Provides access to a broader range of models

## Model Requirements

Kilo Code applies the following filters when fetching models:

- **Streaming:** Models must support streaming
- **Capabilities:** Models must support text generation
- **Context Window:** Models must have a context window of at least 32,000 tokens

## Supported Providers

### Foundation Models Mode

- **OpenAI:** All OpenAI models with active deployments

### Orchestration Mode

- **Amazon:** Amazon foundation models
- **Anthropic:** Claude models
- **Google:** Gemini models
- **OpenAI:** ChatGPT and GPT models
- **Mistral AI:** Mistral AI models

The exact list of available models depends on your SAP AI Core configuration and active model offerings.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "SAP AI Core" from the "API Provider" dropdown.
3. **Enter Credentials:**
    - **Client ID:** Enter your SAP AI Core OAuth2 client ID
    - **Client Secret:** Enter your SAP AI Core OAuth2 client secret
    - **Base URL:** Enter your SAP AI Core API base URL (e.g., `https://api.ai.ml.hana.ondemand.com`)
    - **Auth URL:** Enter your SAP AI Core OAuth2 auth URL (e.g., `https://your-subdomain.authentication.sap.hana.ondemand.com`)
    - **Resource Group:** (Optional) Enter your resource group name, defaults to "default"
4. **Choose Operating Mode:**
    - **Orchestration Mode:** Check the "Use Orchestration" checkbox for broader model access
    - **Foundation Models Mode:** Leave unchecked to use foundation models with deployments
5. **Select Model:** Choose your desired model from the dropdown
6. **Select Deployment:** (Foundation Models Mode only) Choose an active deployment for your selected model

## Deployments (Foundation Models Mode)

When using Foundation Models mode:

- You must have active deployments for the models you want to use
- Only deployments with "RUNNING" status are available for selection
- Deployments in other states (PENDING, STOPPED, etc.) are shown but disabled
- The interface displays the number of available deployments for each model

## Tips and Notes

- **Authentication:** SAP AI Core uses OAuth2 client credentials flow for authentication
- **Caching:** Model and deployment information is cached for 15 and 5 minutes respectively to improve performance
- **Resource Groups:** If you use multiple resource groups, specify the appropriate one in the configuration
- **Permissions:** Ensure your service key has the necessary permissions to access models and deployments
- **Orchestration Benefits:** Use Orchestration mode for access to a wider variety of models without managing deployments
- **Foundation Models Benefits:** Use Foundation Models mode when you need more control over specific model deployments

## Troubleshooting

### Common Issues

1. **Authentication Failures:**

    - Verify your Client ID and Client Secret are correct
    - Check that your Auth URL is properly formatted
    - Ensure your service key hasn't expired

2. **No Models Available:**

    - Check that you have the necessary permissions in your resource group
    - Verify your Base URL is correct
    - In Foundation Models mode, ensure you have running deployments

3. **Deployment Issues:**

    - Check that your deployments are in "RUNNING" status
    - Verify you're using the correct resource group
    - Review your SAP AI Core service configuration

4. **Model Access:**
    - In Foundation Models mode, **only OpenAI models** are currently supported
    - Switch to Orchestration mode for access to other providers
    - Ensure models meet the minimum requirements (32k context window, streaming support)

## Getting Started

To get started with SAP AI Core:

1. Set up your SAP BTP account and access SAP AI Core service
2. Create a service instance and generate a service key
3. Configure Kilo Code with your credentials
4. Choose between Foundation Models or Orchestration mode based on your needs
5. Select an appropriate model and start coding

For detailed setup instructions and service configuration, visit the [SAP AI Core documentation](https://help.sap.com/docs/sap-ai-core).
