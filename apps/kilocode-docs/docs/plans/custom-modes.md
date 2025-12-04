---
sidebar_label: Custom Modes
---

# Custom Modes

Custom Modes let you create tailored versions of Kilo’s built-in [modes](/basic-usage/using-modes) for your organization. You can also adjust the settings for Kilo Code's original default modes. You can define a mode’s purpose, behavior, and tool access — helping Kilo adapt to your team’s unique workflows.

For example, Admins and Owners can extend these by creating **Custom Modes** with specialized roles or personalities (e.g. “Documentation Writer” or “Security Reviewer”).

![Create a new custom mode tab.](/img/teams/custom_modes.png)

## Creating a Custom Mode

1. Go to **Enterprise/Team Dashboard → Custom Modes**.
2. Click **Create New Mode**.
3. Optionally select a **template** (e.g. _User Story Creator_, _Project Research_, _DevOps_).
4. Fill in the following fields:

| Field                              | Description                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Mode Name**                      | Display name for the new mode (e.g. _Security Reviewer_).                                            |
| **Mode Slug**                      | A short identifier used internally (e.g. `security-reviewer`).                                       |
| **Role Definition**                | Describe Kilo’s role and personality for this mode. Shapes how it reasons and responds.              |
| **Short Description**              | A brief summary shown in the mode selector.                                                          |
| **When to Use (optional)**         | Guidance for when this mode should be used. Helps the Orchestrator choose the right mode for a task. |
| **Custom Instructions (optional)** | Add behavioral guidelines specific to this mode.                                                     |
| **Available Tools**                | Select which tools this mode can access (Read, Edit, Browser, Commands, MCP).                        |

5. Click **Create Mode** to save.

Your new mode appears under **Custom Modes** in the Modes dashboard.

---

## Managing Custom Modes

- **Edit:** Click the edit icon to update any field or tool permissions.
- **Delete:** Click the 🗑️ icon to permanently remove the mode.
