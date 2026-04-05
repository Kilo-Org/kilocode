---
title: "AgentCard Integration"
description: "Enable your KiloClaw agents to perform financial transactions with virtual debit cards"
---

# AgentCard Integration

Enable your KiloClaw agents to perform financial transactions by creating and managing virtual debit cards. This integration allows for automated purchasing and expense management within set limits.

## AgentCard Setup

### 1. Create an AgentCard Account

Install the AgentCard CLI and sign up via your terminal:

```bash
agent-cards signup
```

### 2. Add a Payment Method

Link your funding source (via Stripe) to enable the creation of virtual cards:

```bash
agent-cards payment-method
```

### 3. Retrieve Your API Key

Open your local configuration file located at `~/.agent-cards/config.json`. Copy the value assigned to the `jwt` key.

### 4. Configure KiloClaw

1. Paste the **JWT** into the AgentCard setup field in your KiloClaw settings.
2. Click **Save**.
3. Use **Redeploy** to apply the new secret. Only use **Upgrade & Redeploy** if you also need the latest platform version.

## Available Tools

Once activated, your agent will have access to:

- `create_card`: Generate a new virtual debit card.
- `list_cards`: View existing cards and their statuses.
- `check_balance`: Monitor available funds.
