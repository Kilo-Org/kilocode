---
title: "Context Condensing"
description: "Manage conversation context to optimize token usage and maintain long sessions"
---

# Context Condensing

## Overview

When working on complex tasks, conversations with Kilo Code can grow long and consume a significant portion of the AI model's context window. **Context Condensing** is a feature that intelligently summarizes your conversation history, reducing token usage while preserving the essential information needed to continue your work effectively.

## The Problem: Context Window Limits

Every AI model has a maximum context window — a limit on how much text it can process at once. As your conversation grows with code snippets, file contents, and back-and-forth discussions, you may approach this limit. When this happens, you might experience:

- Slower responses as the model processes more tokens
- Higher API costs due to increased token usage
- Eventually hitting the context limit and being unable to continue

{% tabs %}
{% tab label="VSCode" %}

## The Solution: Auto-Compaction

Kilo Code uses a **Compaction** system to manage context automatically. When your conversation approaches the token limit, compaction kicks in and produces an anchored summary that captures:

- The overall goal of the session
- Constraints and preferences you gave along the way
- Progress, key decisions, and next steps
- Critical context needed to continue
- Relevant files and directories

This summary replaces older conversation history while Kilo keeps the most recent turns verbatim when they fit. If a session has already been compacted, Kilo updates the previous summary instead of starting over, preserving still-relevant details and removing stale ones.

## How Compaction Triggers

### Automatic trigger

Kilo checks provider-reported usage after each response and estimates the outgoing text, system instructions, and tool definitions before contacting the provider. Compaction runs when either count reaches `compaction.threshold_percent`, or when the remaining window hits the reserved safety buffer, whichever happens first.

How the buffer is chosen depends on what the model declares. When the model advertises a separate input limit, the buffer defaults to 20,000 tokens (or the model's maximum output size, whichever is smaller). When the model only declares a single context window, Kilo instead reserves the model's full output cap — up to 32,000 tokens.

`compaction.threshold_percent` is optional. Set it from `1` to `100` to compact at that percentage of the model input or context window.

Custom models that do not declare a context window are not tracked, and auto-compaction does not run for them.

### Context Pruning

Between turns, Kilo also runs a lighter **prune** pass. It walks completed tool outputs outside a 40,000-token recency window and replaces them with `"[Old tool result content cleared]"`. Pruning runs incrementally so large tool outputs don't consume space forever, even before full compaction is needed.

### Manual Compaction

You can trigger compaction at any time:

- **Slash command**: type `/compact` in chat (also findable by typing `smol` or `condense`)
- **Task header button**: click the compact icon in the active task header
- **Settings**: toggle auto-compaction in **Settings → Context**

## Defaults

| Setting | Default | Effect |
|---|---|---|
| `compaction.auto` | `true` | Automatically compact when the usable window is reached |
| `compaction.threshold_percent` | unset | Compact when token usage reaches this percentage of the model window |
| `compaction.prune` | `true` | Clear old tool outputs beyond the 40K recency window |
| `compaction.tail_turns` | `2` | Keep the most recent user turns and their responses verbatim when possible |
| `compaction.preserve_recent_tokens` | 25% of usable context, clamped between 2,000 and 8,000 tokens | Token budget for the verbatim recent tail |
| `compaction.reserved` | `min(20,000, model_max_output_tokens)` | Token headroom kept free for the next turn, and a safety trigger if reached before the threshold |

## Configuration

Compaction is configured in your `kilo.jsonc` file:

```jsonc
{
  "compaction": {
    "auto": true, // Enable or disable automatic compaction
    "threshold_percent": 80, // Optional trigger at 80% of the model window
    "prune": true, // Enable pruning of old tool outputs beyond the recency window
    "tail_turns": 2, // Recent user turns to keep verbatim during compaction
    "preserve_recent_tokens": 8000, // Maximum token budget for the recent tail
    "reserved": 20000, // Token buffer kept free; smaller = later trigger, larger = earlier trigger
  },
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `compaction.auto` | boolean | `true` | Enable or disable automatic compaction when the usable window is reached |
| `compaction.threshold_percent` | number | unset | Optional percentage from 1 to 100. Auto-compaction runs when token usage reaches this share of the model input or context window, unless the reserved safety buffer triggers first. |
| `compaction.prune` | boolean | `true` | Enable pruning of old tool outputs outside the 40K token recency window |
| `compaction.tail_turns` | number | `2` | Number of recent user turns, including following assistant and tool responses, to keep verbatim during compaction |
| `compaction.preserve_recent_tokens` | number | 25% of usable context, clamped between 2,000 and 8,000 tokens | Maximum token budget for recent turns kept verbatim after compaction |
| `compaction.reserved` | number | `min(20000, model_max_output)` | Token headroom reserved for the next turn. Applies only to models that advertise a separate input limit; models with a single context window use their full output cap as the reserve instead. |

### Use a different model for compaction

Summarization can use a cheaper or larger-context model than your main agent. Configure a dedicated compaction agent:

```jsonc
{
  "agent": {
    "compaction": {
      "model": "anthropic/claude-haiku-4-5",
    },
  },
}
```

If no compaction agent is set, the current session's model is used.

### Environment overrides

| Variable | Effect |
|---|---|
| `KILO_DISABLE_AUTOCOMPACT=1` | Forces `compaction.auto = false` |
| `KILO_DISABLE_PRUNE=1` | Forces `compaction.prune = false` |
| `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | Overrides the 32,000 default output-token ceiling |

{% /tab %}
{% tab label="CLI" %}

## The Solution: Auto-Compaction

Kilo CLI uses a **Compaction** system to manage context automatically. When your conversation approaches the token limit, compaction kicks in and produces an anchored summary that captures:

- The overall goal of the session
- Constraints and preferences you gave along the way
- Progress, key decisions, and next steps
- Critical context needed to continue
- Relevant files and directories

This summary replaces older conversation history while Kilo keeps the most recent turns verbatim when they fit. If a session has already been compacted, Kilo updates the previous summary instead of starting over, preserving still-relevant details and removing stale ones.

## How Compaction Triggers

### Automatic trigger

Kilo checks provider-reported usage after each response and estimates the outgoing text, system instructions, and tool definitions before contacting the provider. Compaction runs when either count reaches `compaction.threshold_percent`, or when the remaining window hits the reserved safety buffer, whichever happens first.

How the buffer is chosen depends on what the model declares. When the model advertises a separate input limit, the buffer defaults to 20,000 tokens (or the model's maximum output size, whichever is smaller). When the model only declares a single context window, Kilo instead reserves the model's full output cap — up to 32,000 tokens.

`compaction.threshold_percent` is optional. Set it from `1` to `100` to compact at that percentage of the model input or context window.

[Custom models](/docs/code-with-ai/agents/custom-models) that do not declare a context window are not tracked, and auto-compaction does not run for them.

### Context Pruning

Between turns, Kilo also runs a lighter **prune** pass. It walks completed tool outputs outside a 40,000-token recency window and replaces them with `"[Old tool result content cleared]"`. Pruning runs incrementally so large tool outputs don't consume space forever, even before full compaction is needed.

### Manual Compaction

You can trigger compaction at any time:

- **Slash command**: type `/compact` in the TUI (alias: `/summarize`)
- **Keybinding**: press `<leader>c` in the TUI

## Defaults

| Setting | Default | Effect |
|---|---|---|
| `compaction.auto` | `true` | Automatically compact when the usable window is reached |
| `compaction.threshold_percent` | unset | Compact when token usage reaches this percentage of the model window |
| `compaction.prune` | `true` | Clear old tool outputs beyond the 40K recency window |
| `compaction.tail_turns` | `2` | Keep the most recent user turns and their responses verbatim when possible |
| `compaction.preserve_recent_tokens` | 25% of usable context, clamped between 2,000 and 8,000 tokens | Token budget for the verbatim recent tail |
| `compaction.reserved` | `min(20,000, model_max_output_tokens)` | Token headroom kept free for the next turn, and a safety trigger if reached before the threshold |

## Configuration

Compaction is configured in your `kilo.jsonc` file:

```jsonc
{
  "compaction": {
    "auto": true, // Enable or disable automatic compaction
    "threshold_percent": 80, // Optional trigger at 80% of the model window
    "prune": true, // Enable pruning of old tool outputs beyond the recency window
    "tail_turns": 2, // Recent user turns to keep verbatim during compaction
    "preserve_recent_tokens": 8000, // Maximum token budget for the recent tail
    "reserved": 20000, // Token buffer kept free; smaller = later trigger, larger = earlier trigger
  },
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `compaction.auto` | boolean | `true` | Enable or disable automatic compaction when the usable window is reached |
| `compaction.threshold_percent` | number | unset | Optional percentage from 1 to 100. Auto-compaction runs when token usage reaches this share of the model input or context window, unless the reserved safety buffer triggers first. |
| `compaction.prune` | boolean | `true` | Enable pruning of old tool outputs outside the 40K token recency window |
| `compaction.tail_turns` | number | `2` | Number of recent user turns, including following assistant and tool responses, to keep verbatim during compaction |
| `compaction.preserve_recent_tokens` | number | 25% of usable context, clamped between 2,000 and 8,000 tokens | Maximum token budget for recent turns kept verbatim after compaction |
| `compaction.reserved` | number | `min(20000, model_max_output)` | Token headroom reserved for the next turn. Applies only to models that advertise a separate input limit; models with a single context window use their full output cap as the reserve instead. |

### Use a different model for compaction

Summarization can use a cheaper or larger-context model than your main agent. Configure a dedicated compaction agent:

```jsonc
{
  "agent": {
    "compaction": {
      "model": "anthropic/claude-haiku-4-5",
    },
  },
}
```

If no compaction agent is set, the current session's model is used.

### Environment overrides

| Variable | Effect |
|---|---|
| `KILO_DISABLE_AUTOCOMPACT=1` | Forces `compaction.auto = false` |
| `KILO_DISABLE_PRUNE=1` | Forces `compaction.prune = false` |
| `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | Overrides the 32,000 default output-token ceiling |

{% /tab %}
{% /tabs %}

## Best Practices

### When to Compact

- **Long sessions**: If you've been working for an extended period on a complex task
- **Before major transitions**: When switching to a different aspect of your project
- **When approaching limits**: Run `/compact` manually before hitting the automatic trigger if you want control over _when_ the summary is produced

### Tuning compaction triggers

Use `compaction.threshold_percent` when you want compaction to happen at a predictable share of the model window, such as `80` for earlier summaries on long tasks.

The reserved safety buffer still applies and can trigger compaction earlier than the percentage threshold.

On models that advertise a separate input limit, the `reserved` value is a trade-off:

- **Lower value** (e.g. `10000`) → compaction triggers later, you get more turns out of the raw window, but you risk a mid-turn context overflow if a single response is larger than the buffer.
- **Higher value** (e.g. `40000`) → compaction triggers earlier, fewer overflow errors, but shorter effective conversations between summaries.

The default of `~20K` is tuned to leave room for a full-size assistant response plus tool output. The setting has no effect on models with a single context window, which always reserve their full output cap instead.

### Maintaining Context Quality

- **Be specific in your initial task**: A clear task description helps create better summaries
- **Use AGENTS.md**: Combine with [AGENTS.md](/docs/customize/agents-md) for persistent project context that doesn't need to be compacted
- **Review the summary**: After compaction, the summary is visible in your chat history

## Related Features

- [AGENTS.md](/docs/customize/agents-md) - Persistent context storage across sessions
- [Codebase Indexing](/docs/customize/context/codebase-indexing) - Efficient code search and retrieval
