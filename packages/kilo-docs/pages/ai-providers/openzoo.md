---
title: "Using OpenZoo with Kilo Code"
description: "Configure OpenZoo in Kilo Code — an OpenAI-compatible provider with no signup that pays per call, hosted or local via npx."
sidebar_label: OpenZoo
---

# Using OpenZoo With Kilo Code

[OpenZoo](https://openzoo.fun) is an OpenAI-compatible gateway that needs no
account: any API key value is accepted and usage is paid per request — by card,
or automatically via the x402 protocol. It runs hosted at
`https://api.openzoo.fun/v1` or fully locally with `npx openzoo` at
`http://localhost:8402/v1`.

## Before you begin

1. No signup is needed. Use any API key value, for example `sk-openzoo`.
2. Pick a model id from the live catalogue at
   [api.openzoo.fun/v1/models](https://api.openzoo.fun/v1/models) (free to
   fetch). Ids are namespaced, like `z-ai/glm-5.3-flash`.

## Configure Kilo Code

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab, choose **Add a custom provider**, and pick the
   **OpenAI Compatible** type.
3. Set the Base URL to `https://api.openzoo.fun/v1` (or
   `http://localhost:8402/v1` for local).
4. Enter any API key value, e.g. `sk-openzoo`.
5. Enter a model id from `/v1/models`.

## CLI

For the Kilo CLI, add a custom provider to `~/.config/kilo/kilo.json` pointing
at the same base URL (`https://api.openzoo.fun/v1` or the local gateway), with
any API key value, then select it with `kilo auth login --provider`.

## Tips and Notes

- **Local mode:** `npx openzoo` serves the same API at
  `http://localhost:8402/v1` and pays per call from a local burner wallet — no
  cloud dependency.
- **Streaming:** SSE streaming is supported.
- **Billing:** per call; there is no dashboard or account to manage. An HTTP
  402 response carries its own directions (card link and wallet commands).

{% callout type="note" %}
This documentation was contributed by OpenZoo, the provider it describes.
{% /callout %}
