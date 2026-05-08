---
title: "Pricing"
description: "Pricing details for KiloClaw instances and model inference"
---

# Pricing

KiloClaw uses Kilo Gateway credits by default — if you route requests through BYOK, model usage is billed directly by your provider instead.

## Instance Hosting

KiloClaw hosting uses a per-billing-period flat charge, not per-minute or per-action. A KiloClaw subscription is a recurring credit deduction tied to a specific instance. There is no metered hourly/per-minute hosting bill — the deduction happens once at the start of each billing period.

Each instance is a dedicated machine (`performance-cpu-1x`, 3 GB RAM, 10 GB SSD).

| Plan | Period | Cost per period |
|---|---|---|
| Standard | 1 month | $9.00 |
| Commit | 6 months (paid upfront) | $48.00 |
| Trial | 7 days | $0 |

## Model Inference

Model usage is charged against your [Gateway credit balance](/docs/gateway/usage-and-billing). Costs vary by model — premium models like Claude Opus or GPT-5.4-pro cost more per token than smaller models.

## Free Models

Several models are available at **no additional cost** to your Gateway balance. These are great for getting started or for tasks that don't need the most powerful models.

To see which models are currently free, check the [Kilo Leaderboard](https://kilo.ai/leaderboard#all-models) — free models are marked accordingly.

## Adding Credits

You can add Gateway credits from your [Kilo account](https://app.kilo.ai). Credits are shared across all Kilo products (VSCode extension, CLI, Cloud Agents, and KiloClaw).

See [Adding Credits](/docs/getting-started/adding-credits) and [Gateway Usage and Billing](/docs/gateway/usage-and-billing) for details.

## Frequently Asked Questions

**How am I billed for a KiloClaw instance?**
A flat $9/month (Standard) or $48 prepaid for 6 months (Commit, ≈$8/mo). Hardware tier doesn't change the price. Inference (LLM token) usage is billed separately from your Kilo credit balance.

**Do I pay per minute or only when active?**
No. Hosting is a flat per-period charge. Stopping an instance does not pause hosting billing.

**Is there a free trial?**
Yes — 7 days, no credit card required, automatic on your first instance.

**What if I run out of credits?**
If auto top-up is on, we top up automatically. Otherwise, your subscription goes past-due. After 14 days past-due, your instance is stopped and you have 7 more days to pay before the instance is destroyed. Paying any time before destruction auto-restarts the instance.

**Will my data be lost?**
Only after instance destruction (14 + 7 = up to 21 days after the failed renewal). Records of the instance and subscription are retained for audit, but the underlying compute and volume are torn down.

**Can I see my usage?**
Yes — your Kilo credit ledger shows each KiloClaw hosting deduction as a separate `kiloclaw-subscription:...` entry. You'll also receive emails at every milestone (renewal failed, suspension, destruction warning, destroyed).

**Are there caps?**
One active instance per personal context and per organization.
