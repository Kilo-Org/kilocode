---
title: "Cost Controls and Usage Safeguards"
description: "How to prevent runaway agent usage, reduce token consumption, choose the right model, and govern spend at the individual and organization level"
---

# Cost Controls and Usage Safeguards

## Overview

How much you spend with Kilo Code is shaped by several factors working together:

- **Model selection** — frontier models cost significantly more per token than efficient or free tiers
- **Prompt and context size** — every token in your system prompt, conversation history, file attachments, and tool definitions is billed as input
- **Number of agent steps and tool calls** — each step the agent takes (read a file, run a command, write code) generates its own request
- **Repeated retries or loops** — a stuck agent that keeps retrying the same failing step multiplies your cost
- **Background and automated tasks** — long-running or unattended tasks accumulate cost without immediate visibility
- **Session length** — long sessions carry more conversation history into every new request

No single control eliminates cost on its own. The most effective approach combines model selection, context management, task scope, and account-level monitoring together.

This page covers the controls currently available in Kilo Code. For a direct overview of Auto Model tiers and token optimization tips, see [Cost Efficiency & Model Selection](/docs/getting-started/rate-limits-and-costs).

---

## Preventing Loops and Runaway Usage

### Doom loop protection

When the agent enters a repeated failure cycle — attempting the same action multiple times without making progress — Kilo pauses and asks for permission before continuing. This is controlled by the `doom_loop` permission, which defaults to `ask`.

**Where to configure:** Settings → Auto Approve (VS Code) or the `permission.doom_loop` key in `kilo.jsonc` (CLI).

**When to use:** Leave this at `ask` (the default) unless you are running fully unattended automation in a controlled environment. Setting it to `deny` blocks recovery entirely; `allow` lets loops continue without interruption.

### Per-tool approval controls

Every action Kilo takes — reading files, editing code, running shell commands, launching sub-agents — is governed by the permission system. Each tool can be set to `allow`, `ask`, or `deny`. When set to `ask`, Kilo pauses before executing and you can approve or reject that specific action.

**Where to configure:** Settings → Auto Approve (VS Code) or the `permission` section in `kilo.jsonc` (CLI). See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for the full list of available permissions.

**When to use:** Keep `bash` set to `ask` by default for unfamiliar tasks. You can allow specific safe command prefixes (e.g. `git *`, `npm *`) while keeping everything else at `ask`. This prevents the agent from running expensive or destructive commands in a loop without oversight.

### Runtime auto-approve toggle (VS Code)

A shield button in the prompt controls lets you toggle auto-approve on and off at runtime without opening Settings. When enabled, pending permission prompts are approved automatically. The state stays synced across the sidebar and open Kilo tabs.

**When to use:** Turn it on when working on a well-understood, low-risk task that does not need step-by-step review. Turn it off as soon as you want to pause and review the agent's next actions.

### Spending limits

Individual accounts stop spending when their balance reaches zero — further requests to paid models return an error and prompt you to add credits. This acts as a hard ceiling on total spend.

Organization accounts can additionally configure **per-user daily spending limits**. When a member reaches their daily cap, subsequent requests are blocked until midnight UTC, when the limit resets.

**Where to configure:** Organization spending limits are managed in the organization dashboard at [app.kilo.ai](https://app.kilo.ai). Individual credit top-up is at Settings → Adding Credits.

### Free model rate limits

Requests to free models (`kilo-auto/free` and other free-tier models) are rate-limited to **200 requests per hour**. If you exceed this, requests return HTTP 429 and you must wait before continuing.

### Practical recommendations

- **Define a narrow scope before starting.** "Fix the null pointer in `processData`" generates far fewer steps than "keep fixing everything that looks wrong." Specificity reduces both steps and cost.
- **Ask the agent to stop and report after a stage.** Phrases like "analyze the problem and summarize your findings before making any changes" let you review the plan and cost before committing to implementation.
- **Review plans before allowing broad execution.** Use Architect mode (which cannot modify code) to get a plan first, then switch to Code mode to apply it incrementally.
- **Monitor long-running or unattended tasks.** Check the per-request cost estimates in the chat history as the session progresses. If cost is climbing unexpectedly, pause and review what the agent is doing.
- **Avoid open-ended prompts.** Prompts like "keep trying until it works" or "explore the whole codebase and clean it up" give the agent unlimited scope to continue generating steps.

---

## Reducing Context and Token Usage

### Start a new session when the topic changes

Conversation history accumulates with every turn. When you finish a task and move on to something unrelated, starting a new session resets the context to just your system prompt and instructions — significantly cheaper than carrying the full prior conversation.

### Keep prompts focused

Concise, specific prompts cost fewer tokens. Instead of pasting large blocks of background, describe what you need in plain terms and let the agent ask for files if it needs them. Repeating context you already provided earlier in the session is rarely necessary.

### Use `@file` and `@folder` mentions selectively

Attaching an entire folder sends every file in it as input tokens, even if only one or two files are relevant. Use `@file` with specific paths rather than broad directory mentions. When reviewing a bug, include only the file containing the bug and its closest dependencies.

### Exclude generated, build, and vendor directories

Kilo automatically skips a set of directories including `node_modules`, `dist`, `build`, `.git`, `__pycache__`, `.cache`, and `vendor`. You can add additional paths using **permission deny rules** in `kilo.jsonc` or using a `.kilocodeignore` file at your workspace root.

```jsonc
{
  "permission": {
    "read": {
      "coverage/**": "deny",
      ".next/**": "deny",
      "*": "allow"
    }
  }
}
```

**Where to configure:** `kilo.jsonc` (VS Code / CLI). See [.kilocodeignore](/docs/customize/context/kilocodeignore) for full details.

### Compact long conversations

When a conversation grows long, use `/compact` in the chat (also searchable as `smol` or `condense`) to summarize the history and free up context space. Kilo replaces older conversation turns with an anchored summary that captures your goal, constraints, progress, and next steps.

Auto-compaction is **enabled by default** — Kilo automatically compacts when approaching the context window limit so you do not need to intervene manually.

**Where to configure:** Toggle auto-compaction in **Settings → Context** (VS Code) or set `compaction.auto` in `kilo.jsonc`. Configure the trigger threshold with `compaction.threshold_percent` (e.g. `80` to compact at 80% of the model's context window).

You can also configure a cheaper model specifically for compaction, so summarization does not consume frontier model tokens:

```jsonc
{
  "agent": {
    "compaction": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

See [Context Condensing](/docs/customize/context/context-condensing) for full configuration options.

### Keep max output tokens conservative

Every token you allocate to model output reduces how much conversation history can remain in the context window. For routine coding tasks, keep Code mode at **16k max output tokens or below**. Raise the limit only in Architect or Debug modes where extended reasoning is useful.

**Where to configure:** Model settings in the Kilo Code UI, or the `limit.output` key in custom model configuration.

### Use project instructions efficiently

Encode recurring guidance — coding standards, project conventions, preferred libraries — in your `AGENTS.md` or custom instructions once. This avoids repeating the same context in every prompt, and prompt caching means stable instructions are served from cache at a discounted rate on supported providers.

### Disable unused MCP servers

MCP tool definitions are included in the system prompt sent with every request. If you are not using MCP features, disable MCP servers in **Settings → Agent Behaviour → MCP Servers**. This can meaningfully reduce per-request system prompt size.

See [MCP Overview](/docs/automate/mcp/overview) for details.

### Prompt caching

Kilo automatically applies prompt caching on supported providers. Repeated context — your system prompt, stable file contents, and tool definitions — is reused from cache at a discounted rate. No configuration is required to benefit from this.

---

## Choosing Models for Specific Tasks

Different tasks benefit from different model characteristics. Routing work to the right model reduces cost without sacrificing quality.
Kilo has auto-models that can help you control costs; more information is available in [Auto Model](/docs/code-with-ai/agents/auto-model).

### Practical examples by task type

| Task type | Suggested approach |
|---|---|
| Quick questions, syntax lookups, simple formatting | `kilo-auto/efficient` or a lightweight model |
| Routine edits, test generation, straightforward refactors | `kilo-auto/efficient` or a mid-tier model |
| Complex debugging, tracing unexpected behavior | `kilo-auto/frontier` or a strong reasoning model; Debug mode |
| Architecture planning, design decisions | `kilo-auto/frontier`; Architect mode |
| Repository-wide analysis or search | A model with a large context window (256K+); Architect mode |
| Code review and summarization | `kilo-auto/efficient` or a cost-effective model |
| Automated background tasks (CI, scripting) | `kilo-auto/efficient` or `kilo-auto/free` |

### Manually selecting a model

Use the **model selector dropdown** in the Kilo Code chat interface to switch models for the current session. In the CLI, pass the `--model` flag to `kilo run` or use the model picker in the TUI (`Ctrl+X m` or `/models`).

### Configuring a model per agent or mode

You can set a default model for each agent (Code, Architect, Debug, Plan, or a custom subagent) independently:

- **VS Code:** Settings → Models → Model per Mode, or edit `kilo.jsonc` directly.
- **CLI:** Set `agent.<name>.model` in `kilo.jsonc`.

```jsonc
{
  "agent": {
    "code": {
      "model": "kilo-auto/efficient"
    },
    "architect": {
      "model": "kilo-auto/frontier"
    }
  }
}
```

This lets you run cost-effective models for implementation while automatically routing planning tasks to a more capable model.

### Organization-level model restrictions

Enterprise organizations can restrict which models team members may use. See [Enterprise Cost Controls](#enterprise-cost-controls) below.

For full guidance on model selection, see the [Model Selection Guide](/docs/code-with-ai/agents/model-selection).

---

## Enterprise Cost Controls

The following controls are available to organizations and, where noted, are exclusive to Enterprise plans.

### Model access controls (Enterprise only)

Enterprise organization owners can block specific models or entire providers for all team members using the **Providers & Models** page in the dashboard. The system uses a blocklist approach — everything is allowed by default, and admins explicitly block what should not be accessible.

Blocking a provider blocks all current and future models from that provider. Filters are available for:

- Data policy (trains on prompts, retains prompts)
- Provider location / datacenter region
- Specific model ID

Only **Owners** can modify model access controls. Individual members cannot override organization-level restrictions.

**Where to configure:** Dashboard → Providers and Models (Enterprise only). See [Model Access Controls](/docs/collaborate/enterprise/model-access-controls).

**How it helps:** Prevents accidental use of high-cost frontier models; enforces data residency or compliance requirements; limits cost surface by allowing only approved models.

### Shared credit pool and auto top-up

All organization members draw from a single shared credit balance. Administrators can configure:

- **Auto top-up:** Automatically replenish credits when the balance drops below a threshold (minimum $50 balance, minimum $100 purchase)
- **Minimum balance alerts:** Email notifications when the balance drops below a configured amount

**Where to configure:** Dashboard → Billing.

### Usage analytics

The **Usage** tab of the organization dashboard provides:

- Total spend, request count, average cost per request, total tokens, and active users for any selected time period (past week, month, year, or all time)
- Usage broken down by day, by model and day, or by project
- Per-user attribution — individual usage statistics visible to Owners and Admins

This gives administrators visibility into which team members, models, and projects are driving the majority of spend.

**Where to access:** [app.kilo.ai](https://app.kilo.ai) → Usage tab. 

### Administrative permissions

Dashboard administrative actions (model restrictions, spending limits, billing management) are gated by role. Only **Owners** can modify model access controls and organization-level settings. **Owners and Admins** can view per-user usage data.

---

## Recommended Configurations

### Cost-conscious individual developer

- Use `kilo-auto/efficient` as the default model
- Switch to `kilo-auto/free` for low-stakes questions and exploration
- Enable auto-compaction (on by default); set `compaction.threshold_percent: 80` to compact earlier
- Set Code agent max output tokens to 16k or below
- Keep `doom_loop` permission at `ask`
- Start a new session whenever you switch to an unrelated task
- Use `@file` mentions with specific paths instead of `@folder` for whole directories
- Disable any MCP servers you are not actively using

### Developer working on a large repository

- Use Architect mode for initial codebase exploration — it cannot modify code, keeping exploration cost lower
- Use `@file` mentions with specific paths instead of attaching whole directories
- Add generated and build directories to permission deny rules (`coverage/**`, `.next/**`, etc.)
- Configure a cheap model for compaction (`anthropic/claude-haiku-4-5` or equivalent)
- Consider using a model with a large context window (256K+) for cross-file analysis tasks
- Break large tasks into focused sub-tasks rather than asking for a single comprehensive change

### Team using multiple models

- Assign `kilo-auto/efficient` to Code and Debug agents for everyday work
- Assign `kilo-auto/frontier` to Architect (or Plan) agent for planning tasks
- Set `kilo-auto/efficient` as the compaction model for all agents
- If on an Enterprise plan, use Providers & Models to block high-cost models that are not needed for your team's typical work

```jsonc
{
  "agent": {
    "code": { "model": "kilo-auto/efficient" },
    "debug": { "model": "kilo-auto/efficient" },
    "architect": { "model": "kilo-auto/frontier" },
    "compaction": { "model": "anthropic/claude-haiku-4-5" }
  }
}
```

### Maximum-constraint starter configuration

The snippet below is a ready-to-copy `kilo.jsonc` that turns on every available cost-control knob at its most restrictive setting. Drop it into your project root (or your global `~/.config/kilo/kilo.jsonc`) and adjust individual values upward as you get comfortable with how each one behaves.

{% callout type="tip" %}
This configuration uses only `kilo-auto/efficient`.
{% /callout %}

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",

  // ── Model selection ──────────────────────────────────────────────────────
  // Route all requests through the two lowest-cost Kilo Auto tiers.
  // kilo-auto/efficient: lowest-cost paid tier (classifies each request by
  //   difficulty and routes to the cheapest benchmark-proven model).
  "model": "kilo-auto/efficient",
  "subagent_model": "kilo-auto/efficient", // default model for Task-tool subagents

  // ── Per-agent model and step limits ─────────────────────────────────────
  // Assign the cheapest suitable tier to each agent and cap how many
  // agentic iterations it may take before it must produce a text-only reply.
  // Raise `steps` for agents that need more room; lower it to tighten cost.
  "agent": {
    "code": {
      "model": "kilo-auto/efficient",
      "steps": 20 // hard cap on agentic iterations per turn
    },
    "plan": {
      "model": "kilo-auto/efficient",
      "steps": 10
    },
    "debug": {
      "model": "kilo-auto/efficient",
      "steps": 20
    },
    "ask": {
      "model": "kilo-auto/efficient",
      "steps": 5
    },
    "orchestrator": {
      "model": "kilo-auto/efficient",
      "steps": 10
    },
    "explore": {
      "model": "kilo-auto/free",  
      "steps": 15
    },
    "general": {
      "model": "kilo-auto/efficient",
      "steps": 15
    },
    // Dedicated agents for background summarization 
    "compaction": { "model": "kilo-auto/free" },
    "title":      { "model": "kilo-auto/free" },
    "summary":    { "model": "kilo-auto/free" }
  },

  // ── Compaction (context management) ─────────────────────────────────────
  // Auto-compact aggressively to keep conversation history short and cheap.
  "compaction": {
    "auto": true,              // enable automatic compaction (default: true)
    "threshold_percent": 50,   // compact when context reaches 50% full (default: ~80%)
    "prune": true,             // prune old tool outputs to recover context space
    "tail_turns": 1,           // keep only 1 recent user-turn verbatim after compaction
    "preserve_recent_tokens": 2000, // cap on tokens preserved verbatim from recent turns
    "reserved": 8000           // token buffer reserved so compaction itself doesn't overflow
  },

  // ── Tool output truncation ───────────────────────────────────────────────
  // Clip large tool responses early so they don't bloat the context window.
  // Increase these if the agent needs more output (e.g. long test logs).
  "tool_output": {
    "max_lines": 500,    // default: 2000 lines
    "max_bytes": 10240   // default: 51200 bytes (~50 KB)
  },

  // ── Permission safeguards ────────────────────────────────────────────────
  // "ask" means Kilo pauses and requires your approval before executing.
  // This prevents runaway loops from autonomously consuming tokens or making
  // irreversible changes. Flip individual entries to "allow" once you trust them.
  "permission": {
    "bash":       "ask",  // shell commands (highest risk of runaway cost)
    "edit":       "ask",  // file writes and edits
    "task":       "ask",  // launching sub-agents (each sub-agent = extra LLM requests)
    "webfetch":   "ask",  // outbound HTTP fetches
    "websearch":  "ask",  // web search calls
    "doom_loop":  "ask"   // repeated-failure loop detection — always keep at "ask" or "deny"
  },
}
```

Every field in this block is documented in the sections above. Use it as a starting point, then relax individual settings (for example, setting `permission.edit` to `"allow"` for a trusted project, or raising `compaction.threshold_percent` to `70` if compaction feels too aggressive) as you build confidence in how the agent behaves.

---

## Troubleshooting Unexpected Usage

If your spend is higher than expected:

- **Check your usage dashboard** at [app.kilo.ai/usage](https://app.kilo.ai/usage) for a breakdown by day, model, and project
- **Review the model in use** — an accidental switch to a frontier model for routine tasks can significantly raise costs
- **Look for long sessions** — sessions that were never compacted carry their full history as input tokens on every request; use `/compact` to reset them
- **Check MCP server configuration** — unused MCP servers add tool definitions to every system prompt
- **Review permission settings** — auto-approving all actions with no `doom_loop` guard removes the friction that normally slows down runaway loops

For further reading: [4 Levers to Take Control of Your AI Spend](https://blog.kilo.ai/p/4-spend-levers)

## Related

- [Cost Efficiency & Model Selection](/docs/getting-started/rate-limits-and-costs) — Auto Model tier comparison, rate limits, and per-request cost calculation
- [Auto Model](/docs/code-with-ai/agents/auto-model) — Full details on each Auto Model tier and routing strategy
- [Context Condensing](/docs/customize/context/context-condensing) — How compaction works and all configuration options
- [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) — Permission system reference for VS Code and CLI
- [Model Access Controls](/docs/collaborate/enterprise/model-access-controls) — Enterprise model and provider blocklist configuration
- [Usage & Billing](/docs/gateway/usage-and-billing) — Gateway billing mechanics and organization controls
