---
title: "Using Lynkr with Kilo Code"
description: "Route Kilo Code requests by complexity across local and cloud models with Lynkr, a self-hosted OpenAI-compatible gateway."
sidebar_label: Lynkr
---

# Using Lynkr With Kilo Code

Kilo Code works with [Lynkr](https://github.com/Fast-Editor/Lynkr), a self-hosted, Apache-2.0 LLM gateway with an OpenAI-compatible API. Lynkr routes each request by complexity: simple requests go to local models (Ollama, llama.cpp, LM Studio), complex ones to a cloud provider you configure (AWS Bedrock, Azure OpenAI, Databricks, OpenRouter, and others). It also strips unused tool schemas and compresses large JSON tool results, reducing token usage on agentic sessions.

**Website:** [https://github.com/Fast-Editor/Lynkr](https://github.com/Fast-Editor/Lynkr)

## Setting Up Lynkr

1. **Install:** `npm install -g lynkr`
2. **Configure:** Run `lynkr init` — an interactive wizard where you choose tier models (SIMPLE/MEDIUM/COMPLEX/REASONING) across 13 supported providers and enter credentials for the ones you use.
3. **Start:** Run `lynkr start`. The gateway serves `http://localhost:8081`.

## Configuration in Kilo Code

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the custom provider dialog:
   - **Provider ID** — a unique identifier, e.g. `lynkr`.
   - **Display name** — e.g. `Lynkr`.
   - **Provider API** — select **OpenAI Compatible**.
   - **Base URL** — `http://localhost:8081/v1`
   - **API key** — any non-empty value (provider authentication is handled inside Lynkr's own configuration).
   - **Models** — add a placeholder model ID (e.g. `lynkr-auto`); Lynkr's tier routing selects the actual backend model per request.

## Tips and Notes

- **Local-first routing:** With local tiers configured, most simple requests never leave your machine; only complex, tool-heavy requests reach a paid provider.
- **Privacy:** Lynkr is fully self-hosted — requests go only to the providers you configured, with no third-party gateway in between.
- **Tuning:** See [Lynkr's routing documentation](https://github.com/Fast-Editor/Lynkr/blob/main/documentation/routing.md) for tier configuration and complexity-threshold modes.
