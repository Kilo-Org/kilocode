---
title: "Model Selection"
description: "Guide to choosing the right AI model for your tasks"
---

# Model Selection Guide

Here's the honest truth about AI model recommendations: by the time I write them down, they're probably already outdated. New models drop every few weeks, existing ones get updated, prices shift, and yesterday's champion becomes today's budget option.

Instead of maintaining a static list that's perpetually behind, we built something better — a real-time leaderboard showing which models Kilo Code users are actually having success with right now.

## Model Routing and Configuration

Kilo Code doesn't use a single model for everything. There are four separate, independently configurable model slots:

- **Main model** — the primary model your agent uses for coding tasks, chat, and reasoning. This is what you pick with the model selector, `/models`, or the `model` key in `kilo.jsonc`.
- **Small model** — a lightweight model used for session title generation, commit message generation, and prompt enhancement. Configured with the `small_model` key in `kilo.jsonc`, or the **Small Model** field on the **Settings → Models** tab. If left unset, Kilo resolves it from the model already in use: it first looks for a small/cheap variant on your current provider (e.g. Haiku on Anthropic, Flash on Gemini), and only falls back to [`kilo-auto/small`](/docs/gateway/models-and-providers#kilo-autosmall) if the Kilo Gateway provider is authenticated in your session. If you're not signed in to Kilo at all, the small model tasks above simply reuse your main model instead — they don't reach out to Kilo Gateway on their own.
- **Subagent model** — the default model for subagents launched by the `task` tool. Configured with the `subagent_model` key in `kilo.jsonc`, or the **Subagent Model** field on the **Settings → Models** tab. If left unset, subagents inherit whichever model the parent agent session is currently using — this slot never calls Kilo Gateway on its own.
- **Autocomplete model** — the Fill-in-the-Middle (FIM) model used for inline code completions as you type. See [Autocomplete: Provider and Model](/docs/code-with-ai/features/autocomplete#provider-and-model) for how to configure it.

{% callout type="note" %}
**What doesn't use the small model:** context compaction/summarization and todo-list generation always use your main model, not the small model — despite sounding like lightweight background tasks, they aren't affected by your `small_model` setting.
{% /callout %}

Each of these can be set independently. There's no single "offline mode" switch — going fully offline or self-hosted comes down to two things:

1. Never sign in to the Kilo Gateway provider (so there's no `kilo-auto/*` fallback for the app to reach for).
2. Explicitly set your **main model** to a local/BYOK provider (e.g. Ollama, LM Studio, or a direct API key), and **disable autocomplete** — there is no local autocomplete provider, so true offline requires turning it off entirely (see the warning below). You can leave `small_model` and `subagent_model` unset — without a signed-in Kilo provider, they'll fall back to your main model rather than to Kilo Gateway.

{% callout type="warning" %}
**Autocomplete has no local fallback.** Unlike the small and subagent models, autocomplete only supports the Kilo Gateway or a direct BYOK key for Mistral/Inception — if it resolves to Kilo Gateway without valid auth, the request fails outright rather than falling back to a local model. A Mistral/Inception BYOK key bypasses Kilo Gateway but still calls Mistral's or Inception's servers over the network, so it isn't a true offline option. For a fully offline setup, disable autocomplete entirely. If you only need to avoid Kilo Gateway (not all network access), a direct Mistral BYOK key works — see [Setting Up Mistral for Free Autocomplete](/docs/code-with-ai/features/autocomplete/mistral-setup).
{% /callout %}

{% callout type="note" %}
Gas Town also exposes its own small model setting, used for session title generation and the `explore` subagent inside your town's containers — see [Gas Town Settings](/docs/code-with-ai/gastown/settings#small-model). It's a separate, town-scoped configuration stored in your town's settings, distinct from the `small_model` key described above.
{% /callout %}

## Check the Live Models List

**[👉 See what's working today at kilo.ai/models](https://kilo.ai/models)**

This isn't benchmarks from some lab. It's real usage data from developers like you, updated continuously. You'll see which models people are choosing for different tasks, what's delivering results, and how the landscape is shifting in real-time.

## General Guidance

While the specifics change constantly, some principles stay consistent:

### How to Select and Switch Models

{% tabs %}
{% tab label="VSCode" %}

- Use the **model selector** in the chat prompt area to pick a model for the current session. You can also type `/models` to open the model picker.
- When the selected model supports variants, type `/variant` to open the reasoning effort selector.
- Press `Shift+Tab` in the prompt input to cycle to the next reasoning effort variant, wrapping after the last one. This works in the sidebar chat, the Agent Manager prompt, and the New Worktree dialog, and the variant selector tooltip shows the shortcut on hover. To keep `Shift+Tab` for keyboard focus navigation instead, disable the `kilo-code.new.chat.shiftTabCyclesVariant` setting (also available under **Settings → Display**).
- Set per-agent defaults and a global default in the **Settings** panel (Models tab), or directly in the `kilo.jsonc` config file.
- **Model precedence:** Session override → Last picked per agent → Per-agent config → Global config → [Auto Free](/docs/code-with-ai/agents/auto-model#tiers) (note: Auto Free may route to providers that log prompts — see the Auto Model page for details).
- The model selector remembers the last model you picked for each agent, so switching agents restores your previous choice. A manual pick always beats config settings.

{% /tab %}
{% tab label="CLI" %}

- In the TUI, use the **model picker** (`Ctrl+X m` or `/models`) to switch models.
- For non-interactive use, pass `--model` flag to `kilo run` (e.g., `kilo run --model claude-sonnet-4-20250514`).
- Set the global default with the `model` key in `kilo.jsonc`, or configure per-agent models in the `agent` section.
- **Model precedence:** `--model` flag → Per-agent config → Last used in session → Global config → Recent models → First available.

{% /tab %}
{% /tabs %}

**For complex coding tasks**: Premium models (Claude Sonnet/Opus, GPT-5 class, Gemini Pro) typically handle nuanced requirements, large refactors, and architectural decisions better.

**For everyday coding**: Mid-tier models often provide the best balance of speed, cost, and quality. They're fast enough to keep your flow state intact and capable enough for most tasks.

**For budget-conscious work**: Newer efficient models keep surprising us with price-to-performance ratios. DeepSeek, Qwen, and similar models can handle more than you'd expect. See the [free and budget picks](#free-and-budget-model-picks) below.

**For local/private work**: Ollama and LM Studio let you run models locally. The tradeoff is usually speed and capability for privacy and zero API costs.

**Using an unlisted model?** You can register any model — including fine-tunes, newly released models, or custom local models — by adding it to your config file. See [Custom Models](/docs/code-with-ai/agents/custom-models) for details.

## Free and Budget Model Picks

You don't need a paid API key to use Kilo Code productively. For the lowest cost on paid work, [Auto Efficient](/docs/code-with-ai/agents/auto-model#tiers) (`kilo-auto/efficient`) routes each request to the cheapest model proven accurate enough for that task. The fastest way to start for free is [Auto Model Free](/docs/code-with-ai/agents/auto-model) (`kilo-auto/free`), which routes to the best available free models automatically. See [Using Kilo for Free](/docs/getting-started/using-kilo-for-free) for the full zero-cost setup.

If you prefer to pick models yourself, type `free` in the model picker to filter by free models, or browse the full list at [kilo.ai/models](https://kilo.ai/models).

{% callout type="info" %}
Free model availability changes as providers adjust promotional periods. Check [kilo.ai/models](https://kilo.ai/models) for the live list.
{% /callout %}

## Context Windows Matter

One thing that doesn't change: context window size matters for your workflow.

- **Small projects** (scripts, components): 32-64K tokens works fine
- **Standard applications**: 128K tokens handles most multi-file context
- **Large codebases**: 256K+ tokens helps with cross-system understanding
- **Massive systems**: 1M+ token models exist but effectiveness degrades at the extremes

Check [our provider docs](/docs/ai-providers) for specific context limits on each model.

{% callout type="tip" %}
**Be thoughtful about Max Tokens settings for thinking models.** Every token you allocate to output takes away from space available to store conversation history. Consider only using high `Max Tokens` / `Max Thinking Tokens` settings with modes like Architect and Debug, and keeping Code mode at 16k max tokens or less.
{% /callout %}

{% callout type="tip" %}
**Recover from context limit errors:** If you hit the `input length and max tokens exceed context limit` error, you can recover by deleting a message, rolling back to a previous checkpoint, or switching over to a model with a long context window like Gemini for a message.
{% /callout %}

## Models During Delegation

When an agent delegates work to a subagent (via the `task` tool), the subagent **inherits the parent agent's model** by default. You can override this per subagent in your config:

{% tabs %}
{% tab label="CLI" %}

```json
{
  "agent": {
    "explore": {
      "model": "anthropic/claude-haiku-4-20250514"
    }
  }
}
```

This sets the `explore` subagent to always use Haiku regardless of the parent's model. Any subagent without a `model` override uses whatever model the invoking agent is running.

{% /tab %}
{% tab label="VSCode" %}

Subagents inherit the model currently active in the primary agent session — the model shown in the selector at the bottom of the chat. To bypass inheritance and pin a specific model for a subagent:

- **Via Settings** — open **Settings → Models → Model per Mode**, find the subagent, and pick its model.
- **Via config file** — edit `kilo.jsonc`:

```json
{
  "agent": {
    "explore": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

The Settings UI writes the same `agent.<name>.model` entry, so either method produces the same override. Subagents without an explicit model continue to inherit whatever the invoking agent is running.

{% /tab %}
{% /tabs %}

For details on configuring subagent models, see [Custom Subagents](/docs/customize/custom-subagents).

## Selecting a Model or Agent via a Link (VS Code)

The VS Code extension supports a `vscode://` protocol handler that lets you open VS Code and automatically select a model, an agent, or both — no manual picker interaction required. This is useful for sharing model recommendations, launching a specific model tier from a web page, or switching quickly to a preferred agent.

### URL Format

Include at least one of the `model` or `agent` parameters:

```
vscode://kilocode.kilo-code/kilocode/switch?model=<modelID>
vscode://kilocode.kilo-code/kilocode/switch?agent=<agentName>
vscode://kilocode.kilo-code/kilocode/switch?model=<modelID>&agent=<agentName>
```

Replace `<modelID>` with a Kilo Gateway model ID such as `kilo-auto/free`. Replace `<agentName>` with a visible primary agent ID such as `code` or `plan`, rather than its display name.

### Example: Auto Free

To open Kilo Code and switch to the [Auto Free](/docs/code-with-ai/agents/auto-model) tier (`kilo-auto/free`), use:

```
vscode://kilocode.kilo-code/kilocode/switch?model=kilo-auto%2Ffree
```

To switch only to Plan and use its normal model selection, specify the agent without a model:

```
vscode://kilocode.kilo-code/kilocode/switch?agent=plan
```

To select both at the same time, include both parameters:

```
vscode://kilocode.kilo-code/kilocode/switch?model=kilo-auto%2Ffree&agent=plan
```

{% callout type="tip" %}
URL-encode the `/` in model IDs as `%2F` when embedding this URL in HTML links or other contexts where bare slashes may be misinterpreted.
{% /callout %}

### How It Works

- **VS Code open**: the Kilo sidebar is focused and the linked selection is applied to the active session immediately.
- **VS Code closed**: VS Code launches, then applies the selection once the extension is ready.
- When `model` is provided, it must identify a model in the current Kilo Gateway catalog. Invalid or unavailable models cause the deep link to be ignored.
- When `agent` is provided, it must identify a visible primary agent. Invalid or unavailable agents cause the deep link to be ignored.
- An agent-only link uses the model that would normally be selected for that agent. When both parameters are present, the agent is selected first so the linked model applies to it.
- The selection follows the same precedence as using the pickers: it updates the active session, or the next session when no session is active. It does **not** change your configured defaults in settings.

### Sharing and Embedding

You can embed these links in a web page:

```html
<a href="vscode://kilocode.kilo-code/kilocode/switch?model=kilo-auto%2Ffree&amp;agent=plan">
  Open Kilo Code with Auto Free in Plan
</a>
```

Or share as a plain URL that users can paste into their browser's address bar.

## Stay Current

The AI model space moves fast. Bookmark [kilo.ai/models](https://kilo.ai/models) and check back when you're evaluating options. What's best today might not be best next month — and that's actually exciting.
