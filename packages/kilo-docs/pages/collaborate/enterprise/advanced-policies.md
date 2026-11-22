---
title: "Advanced Policies"
description: "Control how your organization's Kilo-paid requests are routed, including inference region and OpenRouter"
---

# Advanced Policies

{% callout type="info" %}
**Advanced policies** is an **Enterprise-only** feature, and Kilo enables it for your organization. Organizations on other plans, or without the feature enabled, do not see the **Advanced policies** tab.
{% /callout %}

The **Advanced policies** tab on your organization's **Providers & Models** page controls how Kilo routes the requests the organization pays for through the Kilo Gateway. It replaces the earlier **Gateways** tab. Only owners and admins can change these settings, and a saved change applies to every member.

{% callout type="note" %}
These policies apply only to requests Kilo pays for. A request that uses a member's own key or a linked billing connection is never pinned to a region and is never refused by these policies. If your organization is downgraded from Enterprise, its saved settings are kept but stop taking effect.
{% /callout %}

## Inference region

Set an **inference region** to keep Kilo-paid requests in the region you choose.

- Kilo sends the request through its Vercel AI Gateway account with the region applied only when Vercel can serve the model there.
- A Kilo-paid request that cannot run in the region — an OpenRouter request, a custom LLM, or a Vercel route that cannot be honored — is refused with an HTTP 403 instead of running outside the region.
- Choosing a region turns **OpenRouter** off. The OpenRouter toggle shows as disabled while a region is set.

## OpenRouter

Turn **OpenRouter** off to refuse the OpenRouter requests Kilo pays for. It does not affect a member's own OpenRouter key, which continues to work.

When OpenRouter is off, Kilo stops applying its model opt-out list to that request, so it can route the model through Vercel when Vercel serves it. A member's own Vercel AI Gateway key already bypassed that list.

## Exempt routes

These routes ignore both policies and are never pinned to a region:

- Requests that use a member's own key: provider keys through Vercel, OpenRouter and Vercel AI Gateway keys, and direct BYOK keys.
- Requests covered by a linked ChatGPT subscription or a [Claude billing link](/docs/ai-providers/claude-linked-billing). Usage accounting already treats them as member-paid.
- Inline completion (FIM) and edit completion requests, which go directly to their providers.

## Keys for embeddings, System One, and transcription

Embedding, System One, and transcription requests resolve a key in the owner's BYOK order: the member's OpenRouter key, then the member's Vercel AI Gateway key, then provider keys through Kilo's Vercel account. When no key applies, Kilo uses its own route — OpenRouter, or Vercel when OpenRouter is disabled.

- A member's organization key covers embedding and System One models served through the Vercel AI Gateway.
- Transcription requests use an OpenRouter key only.
- Advanced policies, such as an inference region, do not apply to a request that uses a member's key.

## Related

- [Model Access Controls](/docs/collaborate/enterprise/model-access-controls)
- [Dashboard](/docs/collaborate/teams/dashboard) — the **Providers and Models** tab
- [Bring Your Own Key (BYOK)](/docs/getting-started/byok)
