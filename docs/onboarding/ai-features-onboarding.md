# AI Features Onboarding Guide

> **Welcome to Kilo Code Advanced AI Features!** > **Version**: 4.144.0
> **Date**: January 12, 2026

---

## 🎉 Welcome!

Congratulations on installing Kilo Code's advanced AI features! This guide will help you get started with our powerful new capabilities:

- **Enhanced Chat with Source Discovery** - Get AI responses with clickable source citations
- **Next Edit Guidance System** - Step-by-step guidance for multi-file changes
- **Context-Aware Intelligent Completions** - Smart completions that understand your entire codebase
- **Slack Integration** - Share conversations and code snippets with your team

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Verify Installation

1. Open VSCode
2. Press `Cmd/Ctrl + Shift + P` to open Command Palette
3. Type `Kilo Code: Validate Setup`
4. Click to run the command

**Expected Result**: You should see a success message confirming all AI features are ready.

### Step 2: Configure AI Provider

1. Press `Cmd/Ctrl + ,` to open Settings
2. Search for "Kilo Code"
3. Configure your AI provider:

    - **OpenAI**: Set `kiloCode.openai.apiKey` to your API key
    - **Anthropic**: Set `kiloCode.anthropic.apiKey` to your API key

4. Test your connection: Run `Kilo Code: Test API Connection` from Command Palette

### Step 3: Try Your First AI Feature

**Enhanced Chat with Citations**:

1. Press `Cmd/Ctrl + Shift + A` to open the AI chat panel
2. Type: "How does authentication work in this project?"
3. Press Enter

**What to expect**: You'll receive an AI response with clickable source citations that link directly to the relevant code!

---

## 📖 Feature Deep Dives

### 1. Enhanced Chat with Source Discovery

#### What It Does

Ask questions about your codebase and receive AI responses with accurate, clickable source citations. No more guessing where code is located!

#### How to Use

**Basic Chat**:

```
1. Press Cmd/Ctrl + Shift + A
2. Type your question
3. Press Enter
4. Click on any citation to jump to that code
```

**Adding Context**:

```
1. Select code in your editor
2. Right-click → "Add to Context"
3. Ask questions about the selected code
```

**Example Questions**:

- "How does the authentication system work?"
- "Where is the user service defined?"
- "What are the main components of the checkout flow?"
- "Show me all API endpoints related to payments"

#### Pro Tips

- **Use specific questions**: "How does JWT token validation work?" is better than "How does auth work?"
- **Add relevant code**: Select code before asking for more accurate answers
- **Check citations**: Always verify the AI's references by clicking the citations
- **Save important chats**: Use the chat history to revisit useful conversations

---

### 2. Next Edit Guidance System

#### What It Does

Plan and execute complex multi-file changes with step-by-step guidance. Never miss a related file again!

#### How to Use

**Create an Edit Plan**:

```
1. Select code you want to refactor
2. Right-click → "Suggest Refactoring Plan"
3. Or press Cmd/Ctrl + Shift + E
4. Review the generated steps
5. Click "Execute Plan" to start
```

**Execute Steps**:

```
1. Review each step's changes
2. Click "Next Step" to proceed
3. Click "Skip Step" if not needed
4. Click "Cancel" to stop
```

**Example Use Cases**:

- Renaming a function used across multiple files
- Migrating from one library to another
- Updating API endpoints throughout the codebase
- Refactoring a large component into smaller pieces

#### Pro Tips

- **Start small**: Try simple refactors first (renaming, moving files)
- **Review carefully**: Always check the preview before executing
- **Use undo**: VSCode's undo works perfectly with edit guidance
- **Save before**: Always save your work before executing large plans

---

### 3. Context-Aware Intelligent Completions

#### What It Does

Get code completions that understand your entire codebase, not just the current file. The AI learns your project's patterns and suggests contextually relevant code.

#### How to Use

**Basic Completions**:

```
1. Start typing code
2. Press Ctrl + Space to trigger AI completion
3. Press Tab to accept, Alt + ] to cycle through options
```

**Natural Language to Code**:

```
1. Type a comment describing what you want
2. Press Tab
3. The AI generates the code for you!

Example:
// TODO: Fetch user data and handle loading state
[Press Tab]
→ const [user, setUser] = useState<User | null>(null)
→ const [loading, setLoading] = useState(true)
→ const [error, setError] = useState<string | null>(null)
```

#### Pro Tips

- **Be descriptive**: More detailed comments = better code generation
- **Use consistent patterns**: The AI learns from your existing code style
- **Train it**: Accept/reject completions to improve future suggestions
- **Adjust settings**: Reduce `maxFiles` if completions are slow

---

### 4. Slack Integration

#### What It Does

Share AI conversations, code snippets, and edit plans with your team directly in Slack. Collaborate on code reviews and share insights instantly.

#### How to Use

**Share a Conversation**:

```
1. In chat, click "Share to Slack"
2. Select your channel
3. Customize the message
4. Click "Share"
```

**Share Code**:

```
1. Select code in editor
2. Right-click → "Share to Slack"
3. Choose formatting (code block, diff, etc.)
4. Select channel
5. Click "Share"
```

**Configure Slack**:

```
1. Run "Kilo Code: Configure Slack Integration"
2. Follow the OAuth flow
3. Authorize Kilo Code to access your workspace
```

#### Pro Tips

- **Use threads**: Replies create threaded discussions in Slack
- **Add context**: Include citations for better understanding
- **Mention team**: Use @mentions to get attention
- **Format nicely**: Code blocks with syntax highlighting look great

---

## 🎯 Feature Discovery Checklist

Use this checklist to explore all features:

### Week 1: Essentials

- [ ] Configure AI provider and test connection
- [ ] Try basic chat with citations
- [ ] Ask about a specific function in your codebase
- [ ] Use "Add to Context" with selected code
- [ ] Create a simple edit plan (rename a function)
- [ ] Try natural language to code completions

### Week 2: Advanced

- [ ] Create a multi-step edit plan
- [ ] Execute edit plan step-by-step
- [ ] Share a chat conversation to Slack
- [ ] Share code snippet to Slack
- [ ] Configure completion settings
- [ ] Adjust citation threshold

### Week 3: Power User

- [ ] Use keyboard shortcuts for all features
- [ ] Create custom edit plans
- [ ] Set up Slack team collaboration
- [ ] Monitor performance metrics
- [ ] Optimize settings for large codebases
- [ ] Explore advanced configuration options

---

## ⌨️ Keyboard Shortcuts Reference

| Action             | Shortcut                                    | Description                |
| ------------------ | ------------------------------------------- | -------------------------- |
| **Chat**           |                                             |                            |
| Focus Chat         | `Cmd/Ctrl + Shift + A`                      | Open AI chat panel         |
| New Chat           | `Cmd/Ctrl + Shift + N`                      | Create new chat session    |
| Add to Context     | `Cmd/Ctrl + K, A`                           | Add selection to context   |
| **Edit Guidance**  |                                             |                            |
| Create Edit Plan   | `Cmd/Ctrl + Shift + E`                      | Create edit plan           |
| Execute Next Step  | `Cmd/Ctrl + ]`                              | Execute next edit step     |
| Skip Step          | `Cmd/Ctrl + [`                              | Skip current step          |
| **Completions**    |                                             |                            |
| Trigger Completion | `Ctrl + Space`                              | Trigger AI completion      |
| Accept Completion  | `Tab`                                       | Accept current completion  |
| Cycle Completions  | `Alt + ]`                                   | Next completion option     |
| Cycle Back         | `Alt + [`                                   | Previous completion option |
| **Slack**          |                                             |                            |
| Share to Slack     | `Cmd/Ctrl + Shift + S`                      | Share current content      |
| **Performance**    |                                             |                            |
| Show Metrics       | `Cmd/Ctrl + Shift + P` → "Show Performance" | View performance stats     |
| Clear Cache        | `Cmd/Ctrl + Shift + P` → "Clear Cache"      | Clear AI cache             |

---

## 🔧 Configuration Guide

### Chat Settings

```json
{
	"kiloCode.chat.enabled": true,
	"kiloCode.chat.enableCitations": true,
	"kiloCode.chat.maxContextFiles": 100,
	"kiloCode.chat.citationThreshold": 0.7,
	"kiloCode.chat.autoSaveContext": true
}
```

**What each setting does**:

- `enabled`: Turn chat feature on/off
- `enableCitations`: Show source citations in responses
- `maxContextFiles`: Maximum files to consider for context
- `citationThreshold`: Minimum confidence for citations (0-1)
- `autoSaveContext`: Automatically save context between sessions

### Edit Guidance Settings

```json
{
	"kiloCode.editGuidance.enabled": true,
	"kiloCode.editGuidance.maxStepsPerPlan": 50,
	"kiloCode.editGuidance.previewChanges": true,
	"kiloCode.editGuidance.confirmBeforeExecute": true,
	"kiloCode.editGuidance.autoDetectRelatedFiles": true
}
```

**What each setting does**:

- `enabled`: Turn edit guidance on/off
- `maxStepsPerPlan`: Maximum steps in a plan
- `previewChanges`: Show diff preview before executing
- `confirmBeforeExecute`: Ask for confirmation before each step
- `autoDetectRelatedFiles`: Automatically find related files

### Completions Settings

```json
{
	"kiloCode.completions.enabled": true,
	"kiloCode.completions.contextWindowSize": 8000,
	"kiloCode.completions.semanticThreshold": 0.8,
	"kiloCode.completions.debounceMs": 300,
	"kiloCode.completions.maxFiles": 50,
	"kiloCode.completions.enableNLToCode": true
}
```

**What each setting does**:

- `enabled`: Turn completions on/off
- `contextWindowSize`: Maximum tokens for context
- `semanticThreshold`: Minimum similarity for semantic search
- `debounceMs`: Delay before triggering completion
- `maxFiles`: Maximum files to scan for context
- `enableNLToCode`: Enable natural language to code

### Slack Settings

```json
{
	"kiloCode.slack.enabled": true,
	"kiloCode.slack.defaultChannel": "#dev-team",
	"kiloCode.slack.includeCodeBlocks": true,
	"kiloCode.slack.autoFormat": true
}
```

**What each setting does**:

- `enabled`: Turn Slack integration on/off
- `defaultChannel`: Default channel for sharing
- `includeCodeBlocks`: Format code with syntax highlighting
- `autoFormat`: Automatically format shared content

---

## 📊 Performance Tips

### For Large Codebases

1. **Reduce context limits**:

    ```json
    {
    	"kiloCode.chat.maxContextFiles": 50,
    	"kiloCode.completions.maxFiles": 30
    }
    ```

2. **Exclude directories**:

    ```json
    {
    	"kiloCode.index.exclude": ["node_modules/**", "dist/**", "build/**", "*.min.js"]
    }
    ```

3. **Enable incremental indexing**:
    ```json
    {
    	"kiloCode.chat.autoSaveContext": true
    }
    ```

### For Slow Performance

1. **Increase debounce time**:

    ```json
    {
    	"kiloCode.completions.debounceMs": 500
    }
    ```

2. **Disable semantic search**:

    ```json
    {
    	"kiloCode.completions.semanticThreshold": 0
    }
    ```

3. **Clear cache periodically**:
    - Run `Kilo Code: Clear Cache` from Command Palette

---

## 🆘 Troubleshooting

### Common Issues

**Citations not showing**:

1. Check `kiloCode.chat.enableCitations` is true
2. Run `Kilo Code: Reindex Codebase`
3. Check AI Features output panel for errors

**Edit plans not generating**:

1. Ensure `kiloCode.editGuidance.enabled` is true
2. Run `Kilo Code: Check AST Support`
3. Try with simpler code selections

**Completions are slow**:

1. Reduce `kiloCode.completions.maxFiles`
2. Increase `kiloCode.completions.debounceMs`
3. Disable semantic search if not needed

**Slack integration failing**:

1. Run `Kilo Code: Test Slack Connection`
2. Verify Slack app permissions
3. Re-authenticate with `Kilo Code: Reconnect Slack`

### Getting Help

- **Documentation**: https://docs.kilo.ai
- **Issues**: https://github.com/Kilo-Org/kilocode/issues
- **Community**: https://discord.gg/kilocode
- **Email**: support@kilo.ai

---

## 🎓 Learning Resources

### Video Tutorials

- [Getting Started with AI Chat](https://docs.kilo.ai/videos/chat-intro)
- [Edit Guidance Deep Dive](https://docs.kilo.ai/videos/edit-guidance)
- [Advanced Completions](https://docs.kilo.ai/videos/completions)

### Blog Posts

- [10 Tips for Better AI Responses](https://blog.kilo.ai/ai-tips)
- [Mastering Edit Plans](https://blog.kilo.ai/edit-plans)
- [Team Collaboration with Slack](https://blog.kilo.ai/slack-integration)

### Example Workflows

- [Refactoring a Large Service](https://docs.kilo.ai/examples/refactor-service)
- [Migrating to New API](https://docs.kilo.ai/examples/api-migration)
- [Code Review Workflow](https://docs.kilo.ai/examples/code-review)

---

## 🎉 You're Ready!

You've completed the onboarding guide. Here's what to do next:

1. **Start small**: Try asking a question about your codebase
2. **Explore features**: Use the feature discovery checklist
3. **Customize settings**: Adjust configurations to your workflow
4. **Share with team**: Set up Slack integration for collaboration
5. **Provide feedback**: Help us improve by reporting issues and suggestions

---

**Happy coding with Kilo Code AI! 🚀**

For more information, visit https://docs.kilo.ai
