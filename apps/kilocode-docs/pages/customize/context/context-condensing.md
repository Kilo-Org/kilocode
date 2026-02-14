---
title: "Context Condensing"
description: "Manage conversation context to optimize token usage and maintain long sessions"
---

# Context Condensing

## Overview

When working on complex tasks, conversations with Kilo Code can grow long and consume a significant portion of the AI model's context window. **Context Condensing** is a feature that intelligently summarizes your conversation history, reducing token usage while preserving the essential information needed to continue your work effectively.

## The Problem: Context Window Limits

Every AI model has a maximum context window - a limit on how much text it can process at once. As your conversation grows with code snippets, file contents, and back-and-forth discussions, you may approach this limit. When this happens, you might experience:

- Slower responses as the model processes more tokens
- Higher API costs due to increased token usage
- Eventually hitting the context limit and being unable to continue

## The Solution: Intelligent Condensing

Context Condensing solves this problem by creating a concise summary of your conversation that captures:

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

## Best Practices

### When to Condense

- **Long sessions**: If you've been working for an extended period on a complex task
- **Before major transitions**: When switching to a different aspect of your project
- **When prompted**: When Kilo Code suggests condensing due to context limits

### Maintaining Context Quality

- **Be specific in your initial task**: A clear task description helps create better summaries
- **Use Memory Bank**: Combine with [Memory Bank](/docs/customize/context/memory-bank) for persistent project context that doesn't need to be condensed
- **Review the summary**: After condensing, the summary is visible in your chat history

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

## Related Features

- [Memory Bank](/docs/customize/context/memory-bank) - Persistent context storage across sessions
- [Large Projects](/docs/customize/context/large-projects) - Managing context for large codebases
- [Codebase Indexing](/docs/customize/context/codebase-indexing) - Efficient code search and retrieval
