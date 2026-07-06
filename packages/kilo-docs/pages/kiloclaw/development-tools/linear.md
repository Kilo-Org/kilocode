---
title: "Linear Integration"
description: "Connect Linear to your KiloClaw agent to create and manage issues automatically"
---

# Linear Integration

Connect Linear to your KiloClaw agent so it can create issues, update their status, read project backlogs, and track work — all automatically. Linear is a project management tool popular with software teams for planning and tracking features, bugs, and tasks.

{% callout type="warning" title="Keep your API key private" %}
Your Linear API key grants access to your workspace. Never share it publicly or commit it to a repository. If a key is ever exposed, revoke it immediately from your Linear account settings and generate a new one.
{% /callout %}

## Prerequisites

Before you begin, make sure you have:

- A **Linear account** with access to the workspace you want KiloClaw to use
- A **KiloClaw agent** already set up — see the [Dashboard Reference](/docs/kiloclaw/dashboard) if you haven't done this yet

## Setup

### Step 1: Generate a Linear API key

1. Log in to your Linear account at [linear.app](https://linear.app)
2. Click your workspace name in the top-left corner and select **Settings**
3. In the left sidebar, go to **Account** → **API**
4. Click **Create key**
5. Give the key a descriptive label (for example, `kiloclaw-bot`) and click **Create**
6. Copy the key — you will only see it once

### Step 2: Add the API key to KiloClaw

1. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
2. Scroll to the **Integrations** section and find **Linear**
3. Paste the API key into the **Linear API Key** field
4. Click **Save**
5. **Redeploy** your instance to apply the changes

### Step 3: Verify the connection

Once your instance has redeployed, send your agent a prompt to check that Linear is working. For example:

- "List the open issues assigned to me in Linear"
- "What projects are in my Linear workspace?"

If the agent returns results from your workspace, the connection is working correctly.

## What Your Agent Can Do

Once connected, your KiloClaw agent can interact with Linear on your behalf:

| Action | Example prompt |
|---|---|
| Create an issue | "Create a Linear issue titled 'Fix login bug' in the Engineering project" |
| Update an issue | "Mark the Linear issue LIN-42 as In Progress" |
| Read issues | "Show me all open bugs assigned to the team this week" |
| Search projects | "What issues are in the Backend project?" |
| Add comments | "Add a comment to LIN-100 saying the fix has been deployed" |

## Related

- [Integrations Overview](/docs/kiloclaw/development-tools)
- [GitHub Integration](/docs/kiloclaw/development-tools/github)
