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

Kilo Code uses a **Compaction** system to manage context automatically. When your conversation approaches the token limit, compaction kicks in and produces a structured summary that captures:

- The overall goal of the session
- Instructions given along the way
- Key discoveries made
- What has been accomplished so far
- Relevant files and directories

This summary replaces the earlier conversation history, freeing up context window space while maintaining continuity in your work.

## How Compaction Triggers

### Automatic trigger

Kilo tracks the total token count for the session — input, output, and cached reads and writes — and compares it to the model's context window. Compaction runs when the total fills the window minus a reserved buffer of headroom kept free for the next turn.

How the buffer is chosen depends on what the model declares. When the model advertises a separate input limit, the buffer defaults to 20,000 tokens (or the model's maximum output size, whichever is smaller). When the model only declares a single context window, Kilo instead reserves the model's full output cap — up to 32,000 tokens.

Custom models that do not declare a context window are not tracked, and auto-compaction does not run for them.

### Context Pruning

Between turns, Kilo also runs a lighter **prune** pass. It walks completed tool outputs outside a 40,000-token recency window and replaces them with `"[Old tool result content cleared]"`. Pruning runs incrementally so large tool outputs don't consume space forever, even before full compaction is needed.

### Manual Compaction

You can trigger compaction at any time:

- **Slash command**: type `/compact` in chat (also findable by typing `smol` or `condense`)
- **Task header button**: click the compact icon in the active task header
- **Settings**: toggle auto-compaction in **Settings → Context**

## Defaults

| Setting               | Default                                | Effect                                                                                 |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `compaction.auto`     | `true`                                 | Automatically compact when the usable window is reached                                |
| `compaction.prune`    | `true`                                 | Clear old tool outputs beyond the 40K recency window                                   |
| `compaction.reserved` | `min(20,000, model_max_output_tokens)` | Token headroom kept free for the next turn — also defines the compaction trigger point |

## Configuration

Compaction is configured in your `kilo.jsonc` file:

```jsonc
{
  "compaction": {
    "auto": true, // Enable or disable automatic compaction
    "prune": true, // Enable pruning of old tool outputs beyond the recency window
    "reserved": 20000, // Token buffer kept free; smaller = later trigger, larger = earlier trigger
  },
}
```

| Option                | Type    | Default                        | Description                                                                                                                                                                                    |
| --------------------- | ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction.auto`     | boolean | `true`                         | Enable or disable automatic compaction when the usable window is reached                                                                                                                       |
| `compaction.prune`    | boolean | `true`                         | Enable pruning of old tool outputs outside the 40K token recency window                                                                                                                        |
| `compaction.reserved` | number  | `min(20000, model_max_output)` | Token headroom reserved for the next turn. Applies only to models that advertise a separate input limit; models with a single context window use their full output cap as the reserve instead. |

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

| Variable                             | Effect                                            |
| ------------------------------------ | ------------------------------------------------- |
| `KILO_DISABLE_AUTOCOMPACT=1`         | Forces `compaction.auto = false`                  |
| `KILO_DISABLE_PRUNE=1`               | Forces `compaction.prune = false`                 |
| `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | Overrides the 32,000 default output-token ceiling |

{% /tab %}
{% tab label="CLI" %}

## The Solution: Auto-Compaction

Kilo CLI uses a **Compaction** system to manage context automatically. When your conversation approaches the token limit, compaction kicks in and produces a structured summary that captures:

- The overall goal of the session
- Instructions given along the way
- Key discoveries made
- What has been accomplished so far
- Relevant files and directories

This summary replaces the earlier conversation history, freeing up context window space while maintaining continuity in your work.

## How Compaction Triggers

### Automatic trigger

Kilo tracks the total token count for the session — input, output, and cached reads and writes — and compares it to the model's context window. Compaction runs when the total fills the window minus a reserved buffer of headroom kept free for the next turn.

How the buffer is chosen depends on what the model declares. When the model advertises a separate input limit, the buffer defaults to 20,000 tokens (or the model's maximum output size, whichever is smaller). When the model only declares a single context window, Kilo instead reserves the model's full output cap — up to 32,000 tokens.

[Custom models](/docs/code-with-ai/agents/custom-models) that do not declare a context window are not tracked, and auto-compaction does not run for them.

### Context Pruning

Between turns, Kilo also runs a lighter **prune** pass. It walks completed tool outputs outside a 40,000-token recency window and replaces them with `"[Old tool result content cleared]"`. Pruning runs incrementally so large tool outputs don't consume space forever, even before full compaction is needed.

### Manual Compaction

You can trigger compaction at any time:

- **Slash command**: type `/compact` in the TUI (alias: `/summarize`)
- **Keybinding**: press `<leader>c` in the TUI

## Defaults

| Setting               | Default                                | Effect                                                                                 |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `compaction.auto`     | `true`                                 | Automatically compact when the usable window is reached                                |
| `compaction.prune`    | `true`                                 | Clear old tool outputs beyond the 40K recency window                                   |
| `compaction.reserved` | `min(20,000, model_max_output_tokens)` | Token headroom kept free for the next turn — also defines the compaction trigger point |

## Configuration

Compaction is configured in your `kilo.jsonc` file:

```jsonc
{
  "compaction": {
    "auto": true, // Enable or disable automatic compaction
    "prune": true, // Enable pruning of old tool outputs beyond the recency window
    "reserved": 20000, // Token buffer kept free; smaller = later trigger, larger = earlier trigger
  },
}
```

| Option                | Type    | Default                        | Description                                                                                                                                                                                    |
| --------------------- | ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction.auto`     | boolean | `true`                         | Enable or disable automatic compaction when the usable window is reached                                                                                                                       |
| `compaction.prune`    | boolean | `true`                         | Enable pruning of old tool outputs outside the 40K token recency window                                                                                                                        |
| `compaction.reserved` | number  | `min(20000, model_max_output)` | Token headroom reserved for the next turn. Applies only to models that advertise a separate input limit; models with a single context window use their full output cap as the reserve instead. |

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

| Variable                             | Effect                                            |
| ------------------------------------ | ------------------------------------------------- |
| `KILO_DISABLE_AUTOCOMPACT=1`         | Forces `compaction.auto = false`                  |
| `KILO_DISABLE_PRUNE=1`               | Forces `compaction.prune = false`                 |
| `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | Overrides the 32,000 default output-token ceiling |

{% /tab %}
{% tab label="VSCode (Legacy)" %}

## The Solution: Intelligent Condensing

**Context Condensing** solves this problem by creating a concise summary of your conversation that captures:

- The original task or goal
- Key decisions made during the session
- Important code changes and their context
- Current progress and next steps

This summary replaces the detailed conversation history, freeing up context window space while maintaining continuity in your work.

## How Context Condensing Works

### Automatic Triggering

Kilo Code monitors your context usage and may suggest condensing when you approach the context window limit. You'll see a notification indicating that condensing is recommended.

### Manual Condensing

You can also trigger context condensing manually at any time using:

- **Chat Command**: Type `/condense` in the chat
- **Settings**: Access condensing options through the Context Condensing settings

### The Condensing Process

When condensing is triggered:

1. **Analysis**: Kilo Code analyzes the entire conversation history
2. **Summarization**: A summary is generated using the configured API, capturing essential context
3. **Replacement**: The detailed history is replaced with the condensed summary
4. **Continuation**: You can continue working with the freed-up context space

## Configuration Options

### API Configuration

Context Condensing uses an AI model to generate summaries. You can configure which API to use for condensing operations:

- Use the same API as your main coding assistant
- Configure a separate, potentially more cost-effective API for condensing

### Profile-Specific Settings

You can configure context condensing thresholds and behavior on a per-profile basis, allowing different settings for different projects or use cases.

## Troubleshooting

### Context Condensing Error

If you see a "Context Condensing Error" message:

- Check your API configuration and ensure it's valid
- Verify you have sufficient credits or API quota
- Try using a different API for condensing operations

### Summary Quality

If the condensed summary doesn't capture important details:

- Consider condensing earlier, before the conversation becomes too long
- Use clear, specific language when describing your tasks
- Important context can be reinforced after condensing by reminding Kilo Code of key details

{% /tab %}
{% /tabs %}

## Best Practices

### When to Compact

- **Long sessions**: If you've been working for an extended period on a complex task
- **Before major transitions**: When switching to a different aspect of your project
- **When approaching limits**: Run `/compact` manually before hitting the automatic trigger if you want control over _when_ the summary is produced

### Tuning `compaction.reserved`

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
- [Large Projects](/docs/customize/context/large-projects) - Managing context for large codebases
- [Codebase Indexing](/docs/customize/context/codebase-indexing) - Efficient code search and retrieval
