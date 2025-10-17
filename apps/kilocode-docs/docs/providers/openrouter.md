---
sidebar_label: OpenRouter
---

# Using OpenRouter With Kilo Code

OpenRouter is an AI platform that provides access to a wide variety of language models from different providers, all through a single API. This can simplify setup and allow you to easily experiment with different models.

**Website:** [https://openrouter.ai/](https://openrouter.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [OpenRouter website](https://openrouter.ai/). Sign in with your Google or GitHub account.
2.  **Get an API Key:** Go to the [keys page](https://openrouter.ai/keys). You should see an API key listed. If not, create a new key.
3.  **Copy the Key:** Copy the API key.

## Supported Models

OpenRouter supports a large and growing number of models. Kilo Code automatically fetches the list of available models. Refer to the [OpenRouter Models page](https://openrouter.ai/models) for the complete and up-to-date list.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "OpenRouter" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your OpenRouter API key into the "OpenRouter API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.
5.  **(Optional) Custom Base URL:** If you need to use a custom base URL for the OpenRouter API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

## Supported Transforms

OpenRouter provides an [optional "middle-out" message transform](https://openrouter.ai/docs/features/message-transforms) to help with prompts that exceed the maximum context size of a model. You can enable it by checking the "Compress prompts and message chains to the context size" box.

## Provider Routing

OpenRouter can route to many different inference providers and this can be controlled in the API Provider settings under Provider Routing.

### Provider Sorting

- Default provider sorting: use the setting in your OpenRouter account
- Prefer providers with lower price
- Prefer providers with higher throughput (i.e. more tokens per seconds)
- Prefer providers with lower latency (i.e. shorter time to first token)
- A specific provider can also be chosen. This is not recommended, because it will result in errors when the provider is facing downtime or enforcing rate limits.

### Data Policy

- No data policy set: use the settings in your OpenRouter account.
- Allow prompt training: providers that may train on your prompts or completions are allowed. Free models generally require this option to be enabled.
- Deny prompt training: providers that may train on your prompts or completions are not allowed.
- Zero data retention: only providers with a strict zero data retention policy are allowed. This option is not recommended, as it will disable many popular providers, such as Anthropic and OpenAI.

## Tips and Notes

- **Model Selection:** OpenRouter offers a wide range of models. Experiment to find the best one for your needs.
- **Pricing:** OpenRouter charges based on the underlying model's pricing. See the [OpenRouter Models page](https://openrouter.ai/models) for details.
- **Prompt Caching:** Some providers support prompt caching. See the OpenRouter documentation for supported models.
