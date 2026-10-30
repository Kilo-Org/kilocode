---
title: "AI Guardrails"
description: "Control which MCP servers and skills your organization can use"
---

# AI Guardrails

AI Guardrails let organization owners set an organization-wide policy for the **MCP servers** and **skills** that members can use, and review an **audit log** of MCP connection activity.

{% callout type="info" %}
AI Guardrails requires the **AI Guardrails** add-on. Organizations without the add-on have every guardrail off, whatever their saved settings say.
{% /callout %}

Open **Guardrails** in your organization's sidebar on the [organization dashboard](https://app.kilo.ai). Settings save automatically a moment after you change them, and a status line shows **Saving**, **Saved**, or the error.

## MCP guardrails

The **MCP guardrails** card controls which MCP servers members can connect Kilo to. When guardrails are on, members can only use the MCP servers you allow.

| Control | What it does |
|---|---|
| **MCP guardrails** switch | Turn organization-wide MCP guardrails on or off. |
| **Audit mode** | Detect server violations but still allow any MCP server. Turn it off to block servers that are not allowed. |
| **Allowed MCP servers** | The MCP servers your members can use. Servers that are not listed are blocked, or only recorded while audit mode is on. |

Turning guardrails on starts in audit mode, so nothing is blocked while you build the allowlist. Add the servers your team uses, watch the audit log for anything else members connect, then turn audit mode off to block the rest. Turning audit mode off with an empty allowlist blocks every MCP server, after a confirmation prompt.

### Adding an allowed MCP server

1. Click **Add MCP server**.
2. Choose a server from the **Kilo registry** or the **MCP registry**, or define a **custom server** with a remote URL or an `npm` or `pypi` package target.
3. Save. The server appears in the **Allowed MCP servers** list.

Custom servers can be edited after you add them. Use the delete button on a server to stop allowing it.

## Skill guardrails

The **Skill guardrails** card controls how skills are handled for your organization.

| Control | What it does |
|---|---|
| **Skill guardrails** switch | Turn organization-wide skill guardrails on or off. |
| **Scan skills before usage** | Scan a skill for policy violations before Kilo uses it. |

## MCP audit log

The **Audit log** lists MCP server usage in your organization from the past 90 days. Connections appear here when members' clients connect to an MCP server.

The log groups connections by server and shows the clients used, how many users were allowed or denied, and when the server was last connected. Use the **result** and **client** filters to narrow the list.

- Click **Users** to see the members behind a server's connections.
- Click **Approve** on a denied server to add it to the allowed list. Approve looks for a matching Kilo registry or MCP registry entry and otherwise adds the server as a custom entry.

## Related

- [Model Access Controls](/docs/collaborate/enterprise/model-access-controls) — Block models and providers for your organization
- [Groups](/docs/collaborate/enterprise/groups) — Grant policies to subsets of members
- [Audit Logs](/docs/collaborate/enterprise/audit-logs) — Track organization and member activity
