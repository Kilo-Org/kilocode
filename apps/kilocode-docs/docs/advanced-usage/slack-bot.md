---
title: Kilo Slackbot
sidebar_label: Kilo Slackbot
---

The Kilo Slackbot brings the power of Kilo Code's AI assistant directly into your Slack workspace. It can answer questions, spawn Cloud Agent sessions to perform coding tasks, and interact with your GitHub repositories—all from within Slack.

---

## Overview

Kilo Bot is an AI-powered Slack integration that:

- **Responds to questions** about code, best practices, and technical concepts
- **Spawns Cloud Agent sessions** to make code changes, fix bugs, and implement features
- **Accesses your GitHub repositories** through your Kilo integrations
- **Understands conversation context** from recent Slack messages and threads
- **Works in channels and DMs** with @mentions or direct messages

---

## Key Features

### Intelligent Response System

Kilo Bot uses advanced AI to determine the best way to handle your request:

- **Direct answers** for conceptual questions, explanations, and documentation
- **Cloud Agent spawning** for tasks requiring code changes, file access, or repository analysis
- **Context awareness** using recent Slack conversation history and available GitHub repositories

### Cloud Agent Integration

When you need to make code changes or analyze repository code, Kilo Bot can spawn Cloud Agent sessions that:

- Make code changes and create pull requests
- Fix bugs and implement new features
- Analyze and research code in your repositories
- Run tests and debug issues
- Refactor and restructure code

### GitHub Repository Access

Kilo Bot has access to all GitHub repositories connected through your Kilo integrations, allowing it to:

- List available repositories
- Identify the correct repository from context
- Pass repository access to Cloud Agents
- Work across multiple repositories in parallel

### Conversation Context

Kilo Bot maintains awareness of:

- Recent messages in the current Slack channel (up to 12 messages)
- Thread history for threaded conversations (up to 20 messages)
- User mentions and references in messages
- Previous interactions in the conversation

---

## Getting Started

### Prerequisites

Before using Kilo Bot, you need:

1. **A Kilo Code account** (personal or organization)
2. **GitHub integration connected** through Kilo Integrations
3. **Slack workspace admin permissions** to install apps

### Installation

#### For Personal Use

1. Go to your [Kilo Integrations page](https://app.kilo.ai/integrations)
2. Find the **Slack** integration panel
3. Click **Configure** or **Connect**
4. You'll be redirected to Slack to authorize the app
5. Select your Slack workspace
6. Click **Allow** to grant permissions
7. You'll be redirected back to Kilo with a success message

#### For Organization Use

1. Go to your [Organization Dashboard](https://app.kilo.ai/organizations)
2. Select your organization
3. Navigate to the **Integrations** tab
4. Find the **Slack** integration panel
5. Click **Configure** or **Connect**
6. Follow the same authorization flow as personal use
7. The bot will be available to all organization members in the workspace

### Required Slack Permissions

Kilo Bot requires the following Slack permissions:

- `app_mentions:read` - To receive @mentions
- `channels:history` - To read channel message history for context
- `channels:join` - To join public channels when invited
- `channels:read` - To view channel information
- `chat:write` - To post messages and replies
- `im:history` - To read direct message history
- `im:read` - To view direct message information
- `im:write` - To send direct messages
- `reactions:write` - To add reaction emojis (for status indicators)
- `users:read` - To resolve user mentions to names

---

## Using Kilo Bot

### In Channels

To interact with Kilo Bot in a Slack channel:

1. **@mention the bot** with your request:
   ```
   @Kilo Bot what's the difference between async/await and promises?
   ```

2. **The bot will respond** in a thread (or create a new thread)

3. **Continue the conversation** in the thread for follow-up questions

### In Direct Messages

You can also send direct messages to Kilo Bot:

1. Open a DM with **Kilo Bot**
2. Send your message (no @mention needed)
3. The bot will respond directly

### Status Indicators

Kilo Bot uses reaction emojis to show status:

- ⏳ **Processing** - The bot is working on your request
- ✅ **Complete** - The bot has finished and posted a response

---

## Commands and Interactions

### Asking Questions

Kilo Bot can answer questions directly without spawning a Cloud Agent:

**Examples:**
```
@Kilo Bot what's the difference between async/await and promises?

@Kilo Bot explain how React hooks work

@Kilo Bot what are best practices for error handling in Node.js?
```

### Making Code Changes

For tasks requiring code changes, Kilo Bot will spawn a Cloud Agent:

**Examples:**
```
@Kilo Bot add error handling to the login function in auth.ts in myorg/myapp

@Kilo Bot fix the bug in the user service where emails aren't being validated

@Kilo Bot implement a new API endpoint for user profile updates in backend-api
```

### Analyzing Code

To analyze or research code in a repository:

**Examples:**
```
@Kilo Bot analyze the authentication flow in myorg/myapp

@Kilo Bot find all the places where we use the old API client

@Kilo Bot review the error handling patterns in our codebase
```

### Specifying Repositories

You can specify repositories in several formats:

- **Full format**: `owner/repo` (e.g., `facebook/react`)
- **URL format**: `github.com/owner/repo`
- **Name only**: If you only have one repository with that name
- **From context**: If a repository was mentioned earlier in the conversation

**Example:**
```
@Kilo Bot in myorg/frontend-app, update the login page to use the new design system
```

---

## How Cloud Agents Work

When Kilo Bot spawns a Cloud Agent, it:

1. **Extracts the repository** from your message or conversation context
2. **Creates a specific task prompt** based on your request
3. **Selects the appropriate mode**:
   - `code` - For implementing features, fixing bugs, making changes (most common)
   - `architect` - For planning, designing, or creating technical specifications
   - `debug` - For investigating issues, analyzing errors, or troubleshooting
   - `ask` - For analyzing code and answering questions about the codebase
   - `orchestrator` - For complex multi-step tasks requiring coordination

4. **Spawns the Cloud Agent** with your GitHub token and organization context
5. **Streams the results** back to Slack
6. **Summarizes the outcome** with links to any PRs created

### Parallel Execution

Kilo Bot can spawn multiple Cloud Agent sessions in parallel for independent tasks:

```
@Kilo Bot 
1. Fix the login bug in frontend-app
2. Update the API documentation in backend-api
3. Add tests for the user service in backend-api
```

---

## Configuration

### Selecting the AI Model

You can configure which AI model Kilo Bot uses:

#### For Personal Integrations

1. Go to [Integrations](https://app.kilo.ai/integrations)
2. Find the Slack integration
3. Click **Settings** or **Configure**
4. Select your preferred model from the dropdown
5. Click **Save**

#### For Organization Integrations

1. Go to your Organization Dashboard
2. Navigate to **Integrations**
3. Find the Slack integration
4. Click **Settings** or **Configure**
5. Select your preferred model
6. Click **Save**

The model selection affects both direct responses and Cloud Agent sessions spawned by the bot.

---

## Best Practices

### Be Specific

The more specific your request, the better Kilo Bot can help:

❌ **Vague**: `@Kilo Bot fix the bug`

✅ **Specific**: `@Kilo Bot fix the bug in auth.ts where users can't log in with special characters in their password`

### Specify the Repository

If you have multiple repositories, always specify which one:

❌ **Ambiguous**: `@Kilo Bot add error handling`

✅ **Clear**: `@Kilo Bot in myorg/backend-api, add error handling to the user service`

### Use Threads

Keep conversations organized by using threads:

- Kilo Bot automatically replies in threads
- Continue follow-up questions in the same thread
- This keeps channels clean and conversations contextual

### Provide Context

Kilo Bot can see recent messages, so you can reference earlier discussion:

```
User: We're having issues with the login flow
User: Users are getting timeout errors
User: @Kilo Bot can you investigate this in our frontend-app?
```

---

## Troubleshooting

### "No Slack integration found for this workspace"

**Solution**: Install the Kilo Slack integration from your [Integrations page](https://app.kilo.ai/integrations)

### "Could not determine the owner of this Slack integration"

**Solution**: Reinstall the Slack integration. This usually happens if the integration was partially set up.

### "Repository not in your available repos"

**Solution**: 
1. Check that you've connected GitHub through [Kilo Integrations](https://app.kilo.ai/integrations)
2. Verify the repository is accessible through your GitHub integration
3. Make sure the KiloConnect GitHub App has access to the repository

### Bot doesn't respond to @mentions

**Possible causes**:
- The bot isn't installed in your workspace
- The bot doesn't have permission to read messages in the channel
- The bot was removed from the channel

**Solution**: 
1. Verify the bot is installed
2. Invite the bot to the channel: `/invite @Kilo Bot`
3. Check that the bot has the required permissions

### "Error calling the AI service"

**Solution**: 
1. Check that you have credits available in your Kilo account
2. Verify your selected model is available
3. Try again in a few moments (may be a temporary service issue)

### Cloud Agent sessions fail

**Solution**:
1. Verify your GitHub integration is connected and working
2. Check that the repository exists and is accessible
3. Ensure the repository name is spelled correctly
4. Review the error message for specific issues

---

## Privacy and Security

### Data Access

Kilo Bot only accesses:

- Messages where it's @mentioned or direct messages sent to it
- Recent message history in channels (for context)
- GitHub repositories you've explicitly connected through Kilo Integrations

### Data Storage

- Slack messages are processed in real-time and not permanently stored
- Request logs are kept for debugging and analytics (team ID, user ID, timestamps, status)
- No message content is stored long-term

### GitHub Access

- Kilo Bot uses your existing GitHub integration
- It has the same repository access as your Kilo account
- All GitHub operations are performed through secure Cloud Agent sessions
- GitHub tokens are never exposed in Slack messages

---

## Limitations

- **Maximum 5 tool iterations** per request to prevent infinite loops
- **Context window limits** based on the selected AI model
- **Rate limits** apply based on your Kilo plan and credits
- **Repository access** limited to what's connected through Kilo Integrations
- **External workspace events** are ignored (messages from users in other Slack workspaces)

---

## Managing Your Integration

### Viewing Connection Status

Check your Slack integration status:

1. Go to [Integrations](https://app.kilo.ai/integrations)
2. Find the Slack panel
3. View connection status and configuration

### Testing the Connection

You can test your Slack integration:

1. Go to your Slack integration settings
2. Click **Test Connection**
3. Optionally, click **Send Test Message** to verify message posting

### Updating Configuration

To change settings:

1. Go to your Slack integration settings
2. Update the model or other settings
3. Click **Save**
4. Changes take effect immediately

### Disconnecting

To remove the Slack integration:

1. Go to your Slack integration settings
2. Click **Disconnect** or **Uninstall**
3. Confirm the action
4. The bot will be removed from your workspace

You can also uninstall from Slack:

1. Go to your Slack workspace settings
2. Navigate to **Apps**
3. Find **Kilo Bot**
4. Click **Remove App**

---

## Support

If you encounter issues with Kilo Bot:

1. Check this documentation for troubleshooting steps
2. Visit the [Kilo Code FAQ](../faq.md)
3. Contact support through the Kilo dashboard
4. Join the Kilo Code community for help

---

## Related Documentation

- [Kilo Integrations](./integrations.md) - Connect GitHub and other services
- [Cloud Agents](./cloud-agent.md) - Learn more about Cloud Agent sessions
- [Organization Management](../plans/team-management.md) - Manage organization integrations
