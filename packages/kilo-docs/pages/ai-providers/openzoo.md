---
title: "Using OpenZoo with Kilo Code"
description: "Configure OpenZoo in Kilo Code — an OpenAI-compatible provider that pays per call over x402 from a local npx proxy, no account."
sidebar_label: OpenZoo
---

# Using OpenZoo With Kilo Code

[OpenZoo](https://openzoo.fun) is an OpenAI-compatible gateway with no
account. You run a small local proxy (`npx openzoo`) that pays for each
request over the x402 protocol from a local burner wallet; Kilo Code talks to
the proxy at `http://localhost:8402/v1` like any other OpenAI-compatible
endpoint.

## Before you begin

1. Start the proxy: `npx openzoo`. It listens on `http://localhost:8402/v1`.
2. Fund its wallet: `npx openzoo address` prints the address — send USDC on
   Solana or Base. `npx openzoo balance` shows what is left.
3. Pick a model id from the live catalogue at
   `http://localhost:8402/v1/models` (free to fetch). Ids are namespaced,
   like `z-ai/glm-5.3-flash`.

## Configure Kilo Code

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab, choose **Add a custom provider**, and pick the
   **OpenAI Compatible** type.
3. Set the Base URL to `http://localhost:8402/v1`.
4. Enter any non-empty API key value, e.g. `sk-openzoo` — the proxy ignores it.
5. Enter a model id from `/v1/models`.

## CLI

For the Kilo CLI, add a custom OpenAI-compatible provider to
`~/.config/kilo/kilo.json` pointing at `http://localhost:8402/v1` with any
non-empty API key value, then select one of its models in the CLI's model
picker.

## Tips and Notes

- **Streaming:** SSE streaming is supported.
- **Billing:** per call from the proxy's wallet; there is no dashboard or
  account to manage. An HTTP 402 from the proxy means the wallet is unfunded.
- **Hosted endpoint:** `https://api.openzoo.fun/v1` answers HTTP 402 unless
  the caller pays x402 or presents an OpenZoo subscription key
  (`ozk_live_…`). Kilo Code cannot pay x402 itself, so use the local proxy.

{% callout type="note" %}
This documentation was contributed by OpenZoo, the provider it describes.
{% /callout %}
