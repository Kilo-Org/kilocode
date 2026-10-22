---
title: "Enterprise MCP Controls"
description: "Proposal for organization-managed MCP controls"
---

# Enterprise MCP Controls

{% callout type="info" title="Status" %}
Proposal - no matching organization MCP allowlist implementation exists yet. Schema, endpoints, dashboard flows, and client enforcement described here are tentative.
{% /callout %}

## Overview

Developers can configure MCP (Model Context Protocol) servers, including marketplace servers and custom servers. Enterprise customers may need organization policy for which MCP servers their developers can use.

This proposal adds an organization-managed allowlist of approved marketplace MCP servers and dashboard-managed member configuration. It is a design document, not current architecture.

## MVP requirements

### Dashboard app

- Give organization administrators a dashboard section for MCP policy.
- Show marketplace MCP servers and let administrators select approved entries.
- Default policy to disabled. If policy is enabled, start with marketplace MCP servers selected to avoid unexpected disruption.
- Record allowlist changes in audit logs.
- Let organization members configure approved servers in dashboard.

### Client behavior

- Keep existing local MCP behavior when organization policy is disabled.
- When organization policy is enabled, replace local MCP configuration with dashboard-managed configuration scoped to organization and member.
- Do not activate or use disallowed local MCP entries.
- If client still detects disallowed local entries while policy is enabled, it may show non-blocking policy feedback. Those entries do not need to appear as activatable MCP options.
- Replace extension marketplace configuration UI with link to dashboard while organization policy is enabled.

This resolves two distinct cases: local entries rejected by policy need not be activated, while dashboard-managed configuration replacement is proposed behavior only when policy is enabled.

## System design

### Current MCP configuration

{% image src="/docs/img/enterprise-mcp-controls-today.png" alt="Current MCP configuration flow" /%}

### Proposed policy-enabled configuration

{% image src="/docs/img/enterprise-mcp-controls-with-ent-control.png" alt="Proposed enterprise MCP controls flow" /%}

When organization policy is enabled, client pulls dashboard-managed configuration instead of using end-user filesystem definitions. Policy-disabled organizations keep existing local behavior.

## Tentative schema

{% callout type="warning" title="Tentative design" %}
Following schema has not shipped. Names, storage layout, encryption approach, and API shape may change during implementation review.
{% /callout %}

Organization settings could hold allowlist policy:

```ts
const OrganizationSettings_MCPControls = z.object({
  mcp_controls_enabled: z.boolean().optional(),
  mcp_controls_allowed_marketplace_servers: z.string().optional(),
})
```

Dashboard-managed member configuration may require encrypted storage:

```sql
create table if not exists organization_member_mcp_configs (
  id uuid not null default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  kilo_user_id text not null references kilocode_users(id),
  config bytea not null,
  created_at timestamptz not null default now()
)
```

Payload shape could start with:

```ts
const OrganizationMemberMCPConfig = z
  .object({ mcp_id: z.string(), parameters: z.record(z.string(), z.string()) })
  .array()
```

## Tentative dashboard and API surface

| Surface | Proposed behavior |
|---|---|
| `/organizations/:id/mcp-control` | Let owners manage allowlist and members configure approved MCP servers |
| `GET /api/marketplace/mcps` | Retrieve marketplace MCP list for policy UI |
| Organization settings API | Read and update enabled state and allowlist |
| Member MCP config API | Store encrypted approved MCP configuration |

These routes and endpoints are placeholders for implementation design. They are not documented as available APIs.

## Scope and implementation plan

| Area | Proposed work |
|---|---|
| Backend | Add policy schema, encrypted member config storage, audit logging, and organization/member APIs |
| Dashboard | Add administrator allowlist UI and member configuration UI |
| Client | Fetch policy-enabled configuration, ignore disallowed local entries, and link to dashboard configuration |

## Future work

- Organization-provided custom MCP server configurations outside marketplace
- Project-level MCP configurations
- Tool-call audit reports grouped by user, project, and MCP server
