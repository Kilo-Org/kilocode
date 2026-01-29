---
sidebar_label: Switching from Cline
---

# Migrating from Cline to Kilo

A practical guide for developers switching from Cline to Kilo.

## Why Switch?

**Speed.** The Kilo Platform is designed to reduce friction across the entire development workflow. Beyond feature parity with Cline, Kilo includes Code Reviews, App Builder, Cloud Agents, and one-click Deploy.

**Multi-platform.** Work in VS Code, JetBrains IDEs, CLI, or the web. Your Sessions sync across all of them automatically.

**Specialized modes.** Instead of one agent doing everything, Kilo has five specialized modes optimized for different parts of your workflow.

**500+ models.** More providers, more options, better pricing flexibility. Switch models mid-conversation if you want.

---

## Understanding Kilo's Mode System

Cline uses a single agent with a Plan/Act toggle. Kilo takes a different approach: five specialized modes, each optimized for a specific part of development. You select modes from a dropdown in the interface in the Kilo Extension, or with slash commands in the CLI.

### Kilo's Five Modes

#### Code Mode (default)

- **What it does:** Implementation and refactoring
- **Cline equivalent:** Act mode
- **When to use:** Writing features, fixing bugs, making changes
- **Example:** "Add user authentication to the API"

#### Ask Mode

- **What it does:** Answers questions, explains code
- **Cline equivalent:** Plan mode (read-only exploration)
- **When to use:** Understanding codebases, learning patterns
- **Example:** "How does our caching layer work?"

#### Debug Mode

- **What it does:** Systematic troubleshooting and error diagnosis
- **Cline equivalent:** Act mode focused on debugging
- **When to use:** Tracking down bugs, fixing runtime issues
- **Example:** "Why is this API endpoint returning 500?"

#### Architect Mode

- **What it does:** Planning, design, and technical leadership
- **Cline equivalent:** Plan mode (exploration and planning)
- **When to use:** Before complex refactors, designing new systems
- **Example:** "Design a caching strategy for our API"

#### Orchestrator Mode

- **What it does:** Breaks down complex tasks, coordinates other modes
- **Cline equivalent:** Complex multi-step workflows
- **When to use:** Large features spanning multiple systems
- **Example:** "Build a complete user management system"

### Mode Switching in Action

**Cline workflow:** Toggle Plan/Act → Submit task → Plan phase → Approve → Act phase → Checkpoint

**Kilo workflow:**  
Select mode from dropdown → Build → Switch modes as needed → Checkpoint → Session auto-saves

Or

Select Orchestrator mode → autonomously define subtasks → intelligently distribute subtasks across modes

#### Example: Refactoring authentication

**Cline:**

1. Enable Plan/Act mode
2. "Refactor auth to use OAuth2"
3. Wait for plan → Review → Approve
4. Watch step-by-step execution
5. Checkpoint when done

**Kilo:**

1. Select **Orchestrator** from the mode dropdown
2. "Implement OAuth2 refactor for our authentication"
3. Orchestrator creates subtasks for other modes automatically
4. **Architect Mode** reviews the architecture
5. **Code Mode** implements the OAuth2 client
6. Session/checkpoints preserved automatically

#### Example: Understanding unfamiliar code

**Cline:** Use Plan mode (but risk accidentally switching to Act)

**Kilo:** Select **Ask** from the dropdown

- "Explain how the payment processing flow works"
- "What external services does this integrate with?"
- Ask mode never writes files, so exploration is always safe

**Why this matters:** In Cline, you might accidentally make changes while exploring. In Kilo, Ask and Architect modes can't write files, so you're safe to explore without worry. Kilo's **Orchestrator** mode lets you intelligently generate and execute subtasks that are optimized for each mode.

---

## Installation

### VS Code / Cursor

1. Open Extensions (`Cmd/Ctrl + Shift + X`)
2. Search "Kilo Code"
3. Click Install
4. Find the Kilo icon in your sidebar

### JetBrains IDEs

Supports IntelliJ, PyCharm, WebStorm, and all JetBrains IDEs.

**Prerequisites:**

- JetBrains Toolbox (required for auth)
- Node.js LTS

**Install:**

1. Settings → Plugins → Marketplace
2. Search "Kilo Code"
3. Install and restart
4. Find Kilo icon in right sidebar

### CLI

```shell
npm install -g @kilocode/cli
kilo
```

### Web (Cloud Agents & App Builder)

Visit [app.kilo.ai](https://app.kilo.ai/) and sign in. This gives you access to:

- **Cloud Agents:** Run Kilo without a local machine
- **App Builder:** Build and preview apps directly in your browser
- **Kilo Deploy:** One-click deployments
- **Code Reviews:** AI-powered PR analysis

---

## Initial Setup

### Create account

1. Click "Try Kilo Code for Free" in the Kilo panel
2. Sign in with OAuth at kilo.ai
3. You'll be redirected back to your IDE

### Configure your provider

**Option 1: Use Kilo Gateway (easiest)**

1. Open settings (⚙️ icon)
2. Select "Kilo Gateway" as provider
3. Choose a model (such as Claude Opus 4.5, Gemini 3, MiniMax M2.1)

**Option 2: Bring your own API keys**

1. Select your provider (Anthropic, OpenAI, etc.)
2. Enter your API key
3. Choose your model

---

## Beyond the IDE: Kilo's Platform Features

One of the biggest differences from Cline is that Kilo isn't just an IDE extension. It's a platform with multiple interfaces that can all share your Sessions and context.

### Cloud Agents

Run Kilo from [app.kilo.ai/cloud](https://app.kilo.ai/cloud) without needing your local machine. Great for:

- Working from a tablet or phone
- Offloading heavy tasks
- Parallel execution without blocking your IDE

### Parallel Agents

Run multiple agents simultaneously without conflicts, in both the IDE and CLI. Start an agent working on tests while another handles documentation.

### Sessions

Your conversation history, context, and state sync across all interfaces automatically. Start a task in the CLI, continue in VS Code, check progress on mobile.

### App Builder

Build live apps and sites directly from the web with a real-time preview. Similar to Lovable, but integrated with your Kilo Sessions. Deploy with one click when you're ready.

### Kilo Deploy

One-click deployments from directly within Kilo. Go from code to production without leaving your workflow.

### Code Reviews

Automatically analyzes your PRs using your choice of AI model. Reviews happen the moment a PR is opened or updated, covering performance, security, style, and test coverage.

### Managed Indexing

Semantic search across your repositories using cloud-hosted embeddings. Kilo indexes your codebase to deliver more relevant, context-aware responses.

### Autocomplete

In-line ghost-text completions with tab to complete. Works alongside the agent modes for a complete coding experience.

---

## Complete Development Workflows

### New Feature Development

**Kilo approach:**

1. **Architect mode:** "Design a user notification system"
2. Review architecture, discuss trade-offs
3. **Code mode:** "Implement the notification service"
4. Fast Apply builds it quickly
5. **Debug mode:** "Email sends aren't working"
6. Fix issues
7. Session auto-saves as "Notifications-Complete"

### Debugging Production Issues

**Kilo approach:**

1. **Debug mode:** "Checkout fails with 'payment_intent_not_found'"
2. Debug mode systematically checks logs, traces API calls
3. **Code mode:** "Add idempotency key to prevent duplicates"
4. Verify fix

### Large Refactoring

**Kilo approach:**

1. **Ask mode:** "Explain our current auth implementation"
2. **Architect mode:** "Design migration to JWT tokens"
3. Session saves as "Auth-Refactor-Plan"
4. **Code mode:** Implement JWT generation, update middleware
5. **Debug mode:** Fix failing tests

### Learning Unfamiliar Code

**Kilo approach:**

1. **Ask mode:** "Explain how payment processing works"
2. "What happens when a payment fails?"
3. "Show me the retry logic"
4. Ask mode never writes, so exploration is completely safe
5. When ready, switch to **Code mode** to make changes

---

## Feature Mapping

| Cline Feature      | Kilo Equivalent                    | Notes                                                                           |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------- |
| Plan mode          | Orchestrator, Architect, Ask modes | Architect plans, Ask explains, Orchestrate distributes tasks across other modes |
| Act mode           | Code mode                          | Implementation                                                                  |
| Plan/Act toggle    | Mode dropdown                      | More granular control                                                           |
| Checkpoints        | Sessions + Checkpoints             | Sessions preserve mode + context                                                |
| Background editing | Fast Apply                         | Sequential but instant                                                          |
| Single agent       | Five specialized modes             | Purpose-built for each task                                                     |
| Local only         | Multi-platform                     | IDE, CLI, web, mobile                                                           |

---

## What You Gain

- **Specialized modes:** Purpose-built for different parts of development
- **Fast Apply:** 5-10x faster code application
- **Autocomplete:** Inline AI suggestions
- **Multi-platform:** VS Code, JetBrains, CLI, web
- **Session Persistance:** Sessions preserve mode + context across devices
- **500+ models:** More provider options, switch anytime
- **Cloud Agents:** Work without your local machine
- **App Builder:** Build and preview apps in the browser
- **One-click Deploy:** Ship directly from Kilo
- **Code Reviews:** AI-powered PR analysis
- **Parallel Agents:** Run multiple agents simultaneously

---

## Common Questions

**Q: Do I have to switch modes constantly?** No. Orchestrator does that automatically. Code mode handles most day-to-day work. Switch when you need specialized behavior.

**Q: What if I forget to switch modes?** Code mode is the default and handles most tasks. It'll still work, just might not be optimized for exploration or planning.

**Q: Can I customize what each mode does?** Yes. Add mode-specific instructions in settings, or create custom modes.

**Q: Can I use both Cline and Kilo side-by-side?** Yes. They're separate extensions.

**Q: What's the difference between Cloud Agents and the IDE extension?** Same capabilities, different interface. Cloud Agents run in the browser, so you can work from any device without your local machine.

---

## Next Steps

1. Install Kilo in your primary IDE
2. Try each mode with a small task:
    - **Code:** "Add a hello world endpoint"
    - **Ask:** "Explain what this file does"
    - **Debug:** "Why is this function returning undefined?"
    - **Architect:** "Design a logging system"
    - **Orchestrator:** "Build an app, end-to-end, that…"
3. Try Cloud Agents at [app.kilo.ai](https://app.kilo.ai/)
4. Install the Kilo CLI with `npm install -g @kilocode/cli`
5. Enable Autocomplete for inline suggestions
