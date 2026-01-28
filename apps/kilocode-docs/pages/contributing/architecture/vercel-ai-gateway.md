---
title: "Vercel AI Gateway"
description: "Vercel AI Gateway architecture"
---

# OpenRouter and Vercel AI Gateway API compatibility

Both OpenRouter and Vercel AI Gateway provide an OpenAI-compatible API.
They are largely compatible and Vercel even adopted some of OpenRouter's non-standard extensions.

OpenRouter API docs: https://openrouter.ai/docs/api/reference/overview

Vercel AI Gateway API docs: https://vercel.com/docs/ai-gateway/openai-compat

At time of writing, OpenRouter provides beta support for the Responses API, but Vercel does not: https://openrouter.ai/docs/api/reference/responses/overview

## Available models and identifiers

OpenRouter has more models than Vercel. The naming scheme is similar, sometimes identical but not always. For example `x-ai/grok-code-fast-1` (OpenRouter) has a different prefix from `xai/grok-code-fast-1` (Vercel). We will have to come up with a mapping from OpenRouter to Vercel model identifiers.

- https://openrouter.ai/models
- https://vercel.com/ai-gateway/models

## Reasoning

Vercel seems to have adopted OpenRouter's (non-standard) reasoning configuration:

- https://openrouter.ai/docs/api/reference/responses/reasoning#reasoning-configuration
- https://vercel.com/docs/ai-gateway/openai-compat#reasoning-configuration

Both Vercel and OpenRouter use the same `reasoning` property for reasoning content (the standard is `reasoning_content`, although our extension will accept both):

- https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request#response.body.choices.message.reasoning
- https://vercel.com/docs/ai-gateway/openai-compat#response-format-with-reasoning

Vercel supports OpenRouter's way of preserving reasoning details in the Chat Completions API:

- https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning-blocks
- https://vercel.com/docs/ai-gateway/openai-compat#preserving-reasoning-details-across-providers

Other providers would require use of the Responses API (e.g. xAI) or Anthropic API (e.g. MiniMax)

## Provider configuration

OpenRouter's and Vercel's provider configuration are different:

- https://openrouter.ai/docs/guides/routing/provider-selection
- https://vercel.com/docs/ai-gateway/openai-compat#provider-options

We will likely support OpenRouter's and convert between the two.

Inference provider identifiers appear similar at first glance, but they may not always be identical.

## Cost calculation

Whether Vercel includes cost in the response (like OpenRouter) is unclear. In the docs there's an embeddings example, which suggests that it does, but in a different format than OpenRouter:

- https://vercel.com/docs/ai-gateway/openai-compat#embeddings

We may have to estimate the cost in the extension instead.

There's a generation endpoint, which looks very similar to OpenRouter's at first glance:

- https://openrouter.ai/docs/api/api-reference/generations/get-generation
- https://vercel.com/docs/ai-gateway/usage#generation-lookup

# Deciding where to route traffic

We want to route some traffic to Vercel, ideally just enough so we can be first place on both leaderboards. However, we will initially start with a small portion of traffic < 5% and will evaluate whether it make sense to increase volume.

Vercel will also act as fallback if we encounter issues with OpenRouter (such as the issue with Grok Code Fast and OpenRouter recently). We need the ability to route certain providers and / or models to Vercel vs OpenRouter.

Requests from the same user for the same model should go to the same gateway for caching purposes.

We can randomize users to a gateway in a way similar to what was done for autocomplete: https://github.com/Kilo-Org/kilocode/pull/3857

Since not all models are available on Vercel, some traffic will have to go to OpenRouter regardless.
