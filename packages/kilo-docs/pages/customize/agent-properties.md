---
title: "Agent Property Reference"
description: "Complete reference for all agent configuration properties in Kilo Code"
platform: new
---

# Agent Property Reference

This page documents every configuration property you can set on an agent in Kilo Code. Properties apply to both built-in agents (like `build` and `plan`) when overriding them and to custom agents you create.

Agents are configured either as entries in the `agent` key of `kilo.jsonc`, or as Markdown files with YAML frontmatter placed in `.kilo/agents/` (project) or `~/.config/kilo/agent/` (global). See [Custom Modes](/docs/customize/custom-modes) and [Custom Subagents](/docs/customize/custom-subagents) for setup instructions.

---

## `description`

**Type:** `string` | **Required for custom agents**

A short summary of what the agent does and when to use it. Shown in the agent picker UI and passed to other agents so they know when to delegate work to this agent via the Task tool.

```yaml
description: Reviews code for security vulnerabilities and suggests fixes
```

**Guidance:** Write this from the perspective of a primary agent that needs to pick a delegate. A specific, action-oriented description ("Performs read-only security audits of source code") works better than a vague one ("Security agent"). If you are creating a subagent, a good description is the primary driver of when the orchestrator will call it.

---

## `model`

**Type:** `string` (format: `provider/model-id`)

Pins a specific model for this agent. If not set, primary agents use the globally configured model and subagents inherit the model of the primary agent that invoked them.

```yaml
model: anthropic/claude-haiku-4-20250514
```

**Guidance:** Use a cheaper or faster model for lightweight tasks (e.g., `plan`, `explore`, `title`) and a more capable model for tasks that require deep reasoning. Pinning a model overrides any manual model selection the user has made for this agent. The model selector in the UI shows a reset button when the active model differs from the config-pinned one.

**Tradeoffs:**
- Faster/cheaper models reduce cost and latency but may produce lower-quality output for complex tasks.
- More capable models improve output quality but increase cost and response time.

---

## `prompt`

**Type:** `string`

The system prompt for this agent. In JSON config, use an inline string or `{file:./path/to/prompt.txt}` to reference an external file. In Markdown agent files, the body of the file (below the frontmatter) becomes the prompt automatically.

```yaml
# In YAML frontmatter — body is the prompt (no explicit field needed)
```

```jsonc
// In kilo.jsonc
{
  "agent": {
    "docs-writer": {
      "prompt": "You are a technical writer. Focus on clarity and completeness."
    }
  }
}
```

**Guidance:** Write the prompt as a direct briefing to the model — describe the agent's role, what it should focus on, what it should avoid, and any constraints. For subagents, the prompt is particularly important because users interact with them indirectly; the prompt fully defines the agent's behavior. Keep prompts focused: a tightly scoped prompt produces more consistent results than a sprawling one.

---

## `mode`

**Type:** `"primary" | "subagent" | "all"` | **Default:** `"all"` for custom agents

Controls how the agent can be used:

| Value | Behavior |
|---|---|
| `primary` | Shown in the agent picker — the user can select it directly |
| `subagent` | Only invokable by other agents via the Task tool or `@` mentions. Not shown in the primary agent picker. |
| `all` | Available both as a selectable primary agent and as a subagent (default for custom agents) |

```yaml
mode: subagent
```

**Guidance:** Use `subagent` for specialist helpers that should only be invoked by the orchestrator or via explicit `@` mention (e.g., a security auditor or a docs writer). Use `primary` if the agent is a specialized workflow you want to switch into directly. Use `all` (the default) if you want maximum flexibility.

---

## `steps`

**Type:** `number`

The maximum number of agentic iterations (tool-call rounds) the agent can perform before being forced to respond with text only. When the limit is reached, the agent is instructed to summarize what it has done and list any remaining tasks.

If not set, the agent continues iterating until the model decides to stop or the user interrupts.

```yaml
steps: 20
```

**Guidance:** Leave unset for most tasks to allow the agent to complete work without interruption. Set a limit when you want to control costs or prevent runaway agents on long-running or uncertain tasks.

**Tradeoffs:**
- **Leave unset:** The agent can complete complex, multi-step tasks fully, but a single session can accumulate many tool calls and significant cost.
- **Set a low value (e.g., 5–15):** Reduces cost and prevents runaway sessions, but the agent may be forced to stop mid-task and ask you to continue.
- **Set a moderate value (e.g., 25–50):** A reasonable cap for most development tasks that still allows meaningful progress before pausing.

---

## `temperature`

**Type:** `number` (range: `0.0` – `1.0`)

Controls the randomness of the model's output. Lower values make responses more focused and deterministic; higher values increase creativity and variability. If not set, the model's default temperature is used (typically `0` for most models).

```yaml
temperature: 0.1
```

**Guidance:**

| Range | Suitable for |
|---|---|
| `0.0–0.2` | Code analysis, planning, structured tasks where consistency matters |
| `0.3–0.5` | General development work — a balance of consistency and adaptability |
| `0.6–1.0` | Brainstorming, documentation drafting, creative tasks |

**Tradeoffs:** Lower temperature improves predictability and reduces surprising outputs, which is usually desirable for agentic coding tasks. Higher temperature can help when you want more varied suggestions or are doing creative work, but increases the chance of unexpected behavior.

---

## `top_p`

**Type:** `number` (range: `0.0` – `1.0`)

An alternative to `temperature` for controlling response diversity. The model only considers the top `p` fraction of the probability distribution when sampling. Lower values are more focused; higher values are more diverse.

```yaml
top_p: 0.9
```

**Guidance:** Use either `temperature` or `top_p` — not both. `temperature` is more commonly supported and easier to reason about. `top_p` can be useful when a provider's documentation recommends it over `temperature` for a specific model.

---

## `permission`

**Type:** `object`

An ordered set of rules that controls which tools this agent can use. Each permission key can be set to:

- `"allow"` — allow the tool without prompting
- `"ask"` — prompt the user for approval before running
- `"deny"` — disable the tool entirely

```yaml
permission:
  edit: deny
  bash: deny
  read: allow
```

You can also use glob patterns for fine-grained control — for example, allowing only specific bash commands:

```yaml
permission:
  bash:
    "*": ask
    "git log*": allow
    "git diff": allow
```

**Available permission keys and the tools they control:**

| Key | Controls |
|---|---|
| `read` | File reading |
| `edit` | File writes, edits, and patches |
| `glob` | Glob file searches |
| `grep` | Content searches |
| `list` | Directory listing |
| `bash` | Shell command execution |
| `task` | Spawning subagents |
| `webfetch` | Fetching URLs |
| `websearch` | Web searches |
| `todowrite` | Todo list management |
| `external_directory` | Access to files outside the project root |

**Rule evaluation:** Rules are applied in order and the **last matching rule wins**. Place broad wildcard rules (`"*"`) before specific ones so the specific rules take precedence.

**Guidance:** Start from a `deny`-heavy baseline for read-only agents (e.g., `edit: deny`, `bash: deny`) and add `allow` rules only for what the agent actually needs. This prevents accidental side effects in specialist agents like code reviewers or planners.

---

## `hidden`

**Type:** `boolean` | **Default:** `false`

When `true`, hides the agent from the `@` autocomplete menu in the chat UI. The agent can still be invoked programmatically by other agents via the Task tool.

```yaml
hidden: true
```

**Guidance:** Use `hidden: true` for internal helper agents that you want only the orchestrator to invoke — not end users. Only meaningful for `mode: subagent` agents.

---

## `color`

**Type:** `string`

Sets the agent's visual accent color in the agent picker and session UI. Accepts a hex color code or one of the built-in theme keywords.

```yaml
color: "#FF5733"
```

```yaml
color: accent
```

**Available theme keywords:** `primary`, `secondary`, `accent`, `success`, `warning`, `error`, `info`

**Guidance:** Color is purely cosmetic but can help users quickly distinguish agents in the picker, especially when you have several custom agents defined.

---

## `disable`

**Type:** `boolean` | **Default:** `false`

When `true`, removes the agent entirely — it will not appear in the picker, cannot be `@` mentioned, and cannot be invoked by other agents.

```yaml
disable: true
```

**Guidance:** Use this to turn off a built-in agent you don't want available (e.g., `general: { disable: true }`) without deleting a config entry. Set back to `false` (or remove the key) to re-enable it.

---

## Provider-specific pass-through options

Any key in the agent config that does not match a documented property is passed through directly to the model provider. This allows you to use model-specific parameters.

For example, to set OpenAI reasoning effort:

```jsonc
{
  "agent": {
    "deep-thinker": {
      "description": "Thorough reasoning for complex architectural decisions",
      "model": "openai/o3",
      "reasoningEffort": "high"
    }
  }
}
```

**Guidance:** Consult your provider's documentation for available parameters. These options are not validated by Kilo and are forwarded as-is to the underlying API.

---

## Full example

A custom subagent combining several properties:

```markdown
---
description: Performs security audits without modifying any files
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
steps: 30
color: "#EF4444"
permission:
  edit: deny
  bash:
    "*": deny
    "git log*": allow
    "grep *": allow
---

You are a security auditor. Your job is to review code for vulnerabilities without making changes.

Focus on:

- Input validation and injection risks
- Authentication and authorization flaws
- Secrets and credentials in source code
- Insecure dependencies
- Data exposure and excessive permissions

Report findings with severity (critical / high / medium / low) and concrete remediation steps.
```

## Related

- [Custom Modes](/docs/customize/custom-modes) — Create and configure primary agents
- [Custom Subagents](/docs/customize/custom-subagents) — Create specialist agents for task delegation
- [Custom Rules](/docs/customize/custom-rules) — Define rules that apply across agents
