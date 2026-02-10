---
title: "API Configuration Profiles"
description: "Create and switch between different sets of AI settings for optimized workflows"
---

# API Configuration Profiles

API Configuration Profiles allow you to create and switch between different sets of AI settings. Each profile can have different configurations for each mode, letting you optimize your experience based on the task at hand.

{% callout type="info" %}
Having multiple configuration profiles lets you quickly switch between different AI providers, models, and settings without reconfiguring everything each time you want to change your setup.
{% /callout %}

## How It Works

Configuration profiles can have their own:

- API providers (OpenAI, Anthropic, OpenRouter, Glama, etc.)
- API keys and authentication details
- Model selections (o3-mini-high, Claude 3.7 Sonnet, DeepSeek R1, etc.)
- [Temperature settings](/docs/code-with-ai/agents/model-selection#temperature) for controlling response randomness
- Thinking budgets
- Provider-specific settings

Note that available settings vary by provider and model. Each provider offers different configuration options, and even within the same provider, different models may support different parameter ranges or features.

## Creating and Managing Profiles

### Creating a Profile

1. Open Settings by clicking the gear icon {% codicon name="gear" /%} → Providers
2. Click the "+" button next to the profile selector

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-1.png" alt="Profile selector with plus button" width="800" caption="Profile selector with plus button" /%}

3. Enter a name for your new profile

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles.png" alt="Creating a new profile dialog" width="800" caption="Creating a new profile dialog" /%}

4. Configure the profile settings:

    - Select your API provider

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-2.png" alt="Provider selection dropdown" width="800" caption="Provider selection dropdown" /%}

- Enter API key

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-3.png" alt="API key entry field" width="800" caption="API key entry field" /%}

- Choose a model

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-8.png" alt="Model selection interface" width="800" caption="Model selection interface" /%}

- Adjust model parameters

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-5.png" alt="Model parameter adjustment controls" width="800" caption="Model parameter adjustment controls" /%}

### Switching Profiles

Switch profiles in two ways:

1. From Settings panel: Select a different profile from the dropdown

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-7.png" alt="Profile selection dropdown in Settings" width="800" caption="Profile selection dropdown in Settings" /%}

2. During chat: Access the API Configuration dropdown in the chat interface

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-6.png" alt="API Configuration dropdown in chat interface" width="800" caption="API Configuration dropdown in chat interface" /%}

### Pinning and Sorting Profiles

The API configuration dropdown now supports pinning your favorite profiles for quicker access:

1. Hover over any profile in the dropdown to reveal the pin icon
2. Click the pin icon to add the profile to your pinned list
3. Pinned profiles appear at the top of the dropdown, sorted alphabetically
4. Unpinned profiles appear below a separator, also sorted alphabetically
5. You can unpin a profile by clicking the same icon again

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-4.png" alt="Pinning API configuration profiles" width="800" caption="Pinning API configuration profiles" /%}

This feature makes it easier to navigate between commonly used profiles, especially when you have many configurations.

### Editing and Deleting Profiles

{% image src="/docs/img/api-configuration-profiles/api-configuration-profiles-10.png" alt="Profile editing interface" width="800" caption="Profile editing interface" /%}

- Select the profile in Settings to modify any settings
- Click the pencil icon to rename a profile
- Click the trash icon to delete a profile (you cannot delete the only remaining profile)

## Linking Profiles to Modes

In the {% codicon name="notebook" /%} Prompts tab, you can explicitly associate a specific Configuration Profile with each Mode. The system also automatically remembers which profile you last used with each mode, making your workflow more efficient.

Watch this demonstration of how to connect configuration profiles with specific modes for optimized workflows:

{% image src="/docs/img/api-configuration-profiles/provider-modes.mp4" alt="Video demonstration of connecting configuration profiles with modes" width="800" caption="Connecting configuration profiles with modes" /%}

## Security Note

API keys are stored securely in VSCode's Secret Storage and are never exposed in plain text.

## Related Features

- Works with [custom modes](/docs/customize/custom-modes) you create
- Integrates with [local models](/docs/ai-providers/ollama) for offline work
- Supports [temperature settings](/docs/code-with-ai/agents/model-selection#temperature) per mode
- Enhances cost management with [rate limits and usage tracking](/docs/getting-started/rate-limits-and-costs)
