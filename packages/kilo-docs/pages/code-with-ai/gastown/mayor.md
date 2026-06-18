---
title: "The Mayor"
description: "How to interact with your town's coordination agent"
---

# {% $markdoc.frontmatter.title %}

The Mayor is your primary interface to a Gas Town. It's a persistent conversational agent that coordinates work, answers questions, and takes action on your behalf.

## What the Mayor Does

The Mayor operates as a technical lead that:

- **Plans work** — converts high-level descriptions into convoys and beads
- **Reports status** — knows what every agent is doing, what's stuck, what's shipped
- **Triages issues** — investigates failures, stuck agents, and escalations
- **Configures the town** — updates settings, manages rigs, adjusts agent behavior
- **Answers questions** — about the codebase, work history, and town state

Unlike polecats (which spin up to work on specific beads), the Mayor runs **persistently**. It's always available, even when no coding agents are active.

{% browserFrame url="app.kilo.ai/gastown/town" caption="The Mayor chat — always available for coordination and questions" %}
{% image src="/docs/img/gastown/gt-town-overview.png" alt="Gas Town Mayor chat interface" /%}
{% /browserFrame %}

## Talking to the Mayor

Open the Mayor panel from your town dashboard. The conversation is persistent — the Mayor remembers context from previous messages within the same session.

### Planning Work

Ask the Mayor to create work for the town:

> *"Create a convoy to add authentication to the API. We need JWT token generation, middleware for protected routes, and integration tests."*

The Mayor will:
1. Break this into individual beads with dependencies
2. Propose a convoy plan for your review
3. Create the convoy (staged by default, so you can review before agents start)

### Checking Status

> *"What's everyone working on?"*
> *"Is anything stuck?"*
> *"How did the last convoy go?"*

The Mayor has full visibility into agent state, bead progress, and recent history.

### Investigating Problems

> *"The auth refactor bead has been in progress for 20 minutes — what's happening?"*
> *"Why did the refinery reject the last review?"*

The Mayor can inspect agent status messages, review feedback, and container logs to diagnose issues.

### Updating Configuration

> *"Switch the model to Auto Frontier for this town"*
> *"Set max polecats to 4"*
> *"Add a custom instruction: always use TypeScript strict mode"*

The Mayor can modify town settings on your behalf through natural language.

## Mayor Tools

The Mayor has access to 21 specialized tools for town management:

### Work Creation

| Tool | What it does |
|---|---|
| `gt_sling` | Delegate a single task to a polecat agent in a specific rig |
| `gt_sling_batch` | Create a multi-bead convoy with dependency ordering, merge mode, and staging options |

### Convoy Management

| Tool | What it does |
|---|---|
| `gt_convoy_status` | Show detailed status of a convoy — each bead's progress and assignee |
| `gt_convoy_start` | Start a staged convoy — begin agent dispatch |
| `gt_convoy_close` | Force-close a convoy and optionally its tracked beads |
| `gt_convoy_update` | Edit convoy metadata (merge mode, feature branch) |
| `gt_convoy_add_bead` | Add an existing bead to a convoy's tracking |
| `gt_convoy_remove_bead` | Remove a bead from a convoy |
| `gt_list_convoys` | List active convoys with progress counts |

### Bead Management

| Tool | What it does |
|---|---|
| `gt_bead_update` | Edit a bead's status, title, body, priority, labels, or dependencies |
| `gt_bead_reassign` | Reassign a bead to a different agent |
| `gt_bead_delete` | Delete one or more beads (supports bulk — up to 5000) |
| `gt_list_beads` | List beads in a rig, filterable by status and type |

### Agent Management

| Tool | What it does |
|---|---|
| `gt_agent_reset` | Force-reset an agent to idle, unhooking it from any bead |
| `gt_nudge` | Send a real-time nudge to a polecat (immediate, wait-idle, or queued) |
| `gt_list_agents` | List all agents in a rig with their roles and status |
| `gt_mail_send` | Send a persistent mail message to any agent in any rig |

### Town & UI

| Tool | What it does |
|---|---|
| `gt_list_rigs` | List all rigs (repositories) in the town |
| `gt_ui_action` | Trigger UI actions — open drawers, navigate pages, highlight items |
| `gt_escalation_acknowledge` | Acknowledge an escalation as reviewed |
| `gt_report_bug` | File a bug report on the Gastown GitHub repo (checks for duplicates first) |

These tools are used automatically when you make requests — you don't need to invoke them directly.

## Tips for Effective Communication

### Be specific about scope

Instead of: *"Fix the bugs"*

Try: *"Fix the TypeScript type errors in src/auth/. There are 3 reported in the CI output."*

### Use convoys for complex work

Instead of: *"Add a user dashboard with charts, settings, and notifications"*

Try: *"Create a staged convoy for the user dashboard. Break it into: 1) dashboard layout and navigation, 2) chart components with mock data, 3) settings page, 4) notification system. Each should build on the previous."*

### Let the Mayor triage

When something goes wrong, ask the Mayor before investigating yourself:

> *"Bead abc123 has been stuck for 30 minutes — can you investigate?"*

The Mayor can often diagnose and resolve issues (reset agents, close stuck convoys, re-dispatch work) without you needing to dig into the admin panel.

## Mayor Limitations

- The Mayor coordinates but doesn't write code itself — that's what polecats are for
- It can only see what's happening inside your town, not external systems
- Complex multi-repo orchestration may need manual coordination between towns
- The Mayor's context window is bounded — very long conversations may lose early context
