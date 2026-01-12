# Quick Start Guide: Advanced AI Features Enhancement

**Date**: January 12, 2026  
**Feature**: Enhanced AI capabilities with source discovery, edit guidance, and Slack integration  
**Phase**: 1 - Design & Contracts

## Overview

This guide provides step-by-step instructions for setting up and using the advanced AI features in Kilo Code. The enhancement includes four major components:

1. **Enhanced Chat with Source Discovery** - AI responses with clickable source citations
2. **Next Edit Guidance System** - Step-by-step guidance for multi-file changes
3. **Context-Aware Intelligent Completions** - Smart completions with full codebase context
4. **Slack Integration** - Share conversations and code snippets with your team

## Prerequisites

- Kilo Code extension v4.143.2 or later
- Node.js 20.19.2 or later
- VSCode 1.84.0 or later
- Active AI provider configured (OpenAI, Anthropic, or compatible)
- (Optional) Slack workspace for team integration

## Installation & Setup

### 1. Install Dependencies

```bash
# Navigate to project directory
cd /Users/emad/Documents/kilocode

# Install all dependencies
pnpm install

# Build the extension
pnpm build

# Install extension in VSCode
code --install-extension kilocode.kilo-code.vsix
```

### 2. Configure AI Provider

1. Open VSCode settings (`Cmd/Ctrl + ,`)
2. Search for "Kilo Code"
3. Configure your preferred AI provider:
    - **OpenAI**: Set API key in `kilo-code.openai.apiKey`
    - **Anthropic**: Set API key in `kilo-code.anthropic.apiKey`
    - **Other**: Configure provider-specific settings

**Validation**: Run command palette (`Cmd/Ctrl + Shift + P`) and type "Kilo Code: Test API Connection" to verify your API key is valid.

### 3. Enable Advanced Features

Open your VSCode settings.json (`Cmd/Ctrl + Shift + P` → "Preferences: Open User Settings (JSON)") and add:

```json
{
	"kiloCode.chat.enabled": true,
	"kiloCode.chat.enableCitations": true,
	"kiloCode.editGuidance.enabled": true,
	"kiloCode.completions.enabled": true,
	"kiloCode.slack.enabled": true,
	"kiloCode.performance.enableMetrics": true,
	"kiloCode.performance.enableLogging": true
}
```

**Validation**: Reload VSCode window (`Cmd/Ctrl + Shift + P` → "Developer: Reload Window") to apply settings.

### 4. Initialize AI Services

```bash
# From the project root, run the initialization script
cd /Users/emad/Documents/kilocode
pnpm run init-ai-services
```

**Validation**: Check that the following services are running:

- Open VSCode Output panel (`View → Output`)
- Select "AI Features" from the dropdown
- You should see: "AI services initialized successfully"

### 5. Slack Integration (Optional)

1. Install the Kilo Code Slack app: https://slack.com/apps/A0123456789
2. Click "Add to Slack"
3. In VSCode, run command palette: `Kilo Code: Configure Slack Integration`
4. Follow the OAuth flow to connect your workspace

**Validation**: Run command `Kilo Code: Test Slack Connection` to verify the integration is working.

## Feature Usage

### Enhanced Chat with Source Discovery

#### Starting a Chat Session

1. Open Kilo Code sidebar (`Cmd/Ctrl + Shift + A`)
2. Click "New Chat" or use command palette: `Kilo Code: New Task`
3. Ask questions about your codebase:

```
How does authentication work in this project?
What are the main components of the user service?
Where is the database connection configured?
```

#### Understanding Citations

AI responses now include source citations:

```markdown
Authentication is handled by the `AuthService` class [src/services/auth/AuthService.ts:45-67].
The service uses JWT tokens for session management [src/services/auth/jwt.ts:12-34].
Login routes are defined in the auth controller [src/controllers/auth.ts:89-112].

📚 Sources:

- src/services/auth/AuthService.ts (lines 45-67)
- src/services/auth/jwt.ts (lines 12-34)
- src/controllers/auth.ts (lines 89-112)
```

#### Clickable Citations

- **File citations**: Click to open file at specific line
- **Documentation**: Opens external documentation in browser
- **URL citations**: Opens link in default browser

#### Chat Context Management

1. Select code in editor → Right-click → "Add to Context"
2. Use command palette: `Kilo Code: Add to Context`
3. Context persists throughout the chat session

### Next Edit Guidance System

#### Creating an Edit Plan

1. Select code you want to refactor
2. Right-click → "Suggest Refactoring Plan"
3. Or use command palette: `Kilo Code: Create Edit Plan`

Example: Renaming a function used across multiple files:

```
📋 Edit Plan: Rename `getUserData` to `fetchUserProfile`

Step 1: Update function definition
📁 src/services/userService.ts:23
- Rename function `getUserData` to `fetchUserProfile`

Step 2: Update imports (3 files)
📁 src/components/UserProfile.ts:5
📁 src/pages/Dashboard.ts:8
📁 src/utils/userHelpers.ts:12

Step 3: Update function calls (7 locations)
📁 src/components/UserProfile.ts:45
📁 src/pages/Dashboard.ts:67
...

[Execute Plan] [Skip Step] [Cancel]
```

#### Executing Edit Plans

1. Review the generated steps
2. Click "Execute Plan" to start
3. Use "Next Step" / "Previous Step" to navigate
4. Each step shows:
    - Files to be modified
    - Preview of changes
    - Impact analysis

#### Custom Edit Plans

Create manual plans for complex changes:

```typescript
// Select code → Create Custom Plan
const editPlan = {
	title: "Migrate from Redux to Zustand",
	steps: [
		{
			title: "Install Zustand",
			type: "dependency",
			action: "npm install zustand",
		},
		{
			title: "Create store",
			type: "create",
			files: ["src/store/userStore.ts"],
		},
		{
			title: "Update components",
			type: "update",
			files: ["src/components/*.tsx"],
		},
	],
}
```

### Context-Aware Intelligent Completions

#### Enhanced Code Completions

Completions now understand your entire codebase:

```typescript
// Type this in a React component:
const [user, setUser] = useState(
// Kilo Code suggests:
// - useState<User | null>(null) // based on User type definition
// - useState(initialUser) // based on existing patterns
// - useState(getInitialUser()) // based on similar components
```

#### Natural Language to Code

Write comments in natural language:

```typescript
// TODO: Fetch user data from API and handle loading state
// Press Tab → Kilo Code generates:
const [user, setUser] = useState<User | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
	const fetchUser = async () => {
		try {
			setLoading(true)
			const response = await userApi.getCurrentUser()
			setUser(response.data)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	fetchUser()
}, [])
```

#### Context Settings

Configure completion context:

```json
{
	"kilo-code.completions.context": {
		"includeDependencies": true,
		"includeTests": false,
		"maxFiles": 50,
		"semanticSearch": true
	}
}
```

### Slack Integration

#### Sharing Conversations

1. In chat, click "Share to Slack" button
2. Select channel and customize message:

```
🤖 Kilo Code Analysis

Question: How does the auth system work?

Answer: The authentication system uses JWT tokens with the AuthService class...

📊 Context: 15 files analyzed, 8 citations included
🔗 View in Kilo Code: [link]
```

#### Sharing Code Snippets

1. Select code in editor
2. Right-click → "Share to Slack"
3. Choose formatting options:
    - Code block with syntax highlighting
    - File reference with line numbers
    - Diff format for changes

#### Team Collaboration Features

- **Threaded discussions**: Replies create Slack threads
- **Mentions**: @team members in shared content
- **Reactions**: Add emoji reactions to shared insights
- **Search**: Search shared content in Slack

## Configuration

### Advanced Settings

```json
{
	"kilo-code.chat": {
		"maxContextFiles": 100,
		"citationThreshold": 0.7,
		"autoSaveContext": true
	},
	"kilo-code.editGuidance": {
		"maxStepsPerPlan": 50,
		"previewChanges": true,
		"confirmBeforeExecute": true
	},
	"kilo-code.completions": {
		"contextWindowSize": 8000,
		"semanticThreshold": 0.8,
		"debounceMs": 300
	},
	"kilo-code.slack": {
		"defaultChannel": "#dev-team",
		"includeCodeBlocks": true,
		"autoFormat": true
	}
}
```

### Keyboard Shortcuts

| Feature             | Shortcut               | Description              |
| ------------------- | ---------------------- | ------------------------ |
| Focus Chat          | `Cmd/Ctrl + Shift + A` | Open Kilo Code chat      |
| New Task            | `Cmd/Ctrl + Shift + N` | Create new chat task     |
| Add to Context      | `Cmd/Ctrl + K, A`      | Add selection to context |
| Edit Plan           | `Cmd/Ctrl + Shift + E` | Create edit plan         |
| Share to Slack      | `Cmd/Ctrl + Shift + S` | Share current content    |
| Next Suggestion     | `Tab`                  | Accept completion        |
| Previous Suggestion | `Shift + Tab`          | Cycle back suggestions   |

## Troubleshooting

### Common Issues

#### Citations Not Showing

**Problem**: AI responses don't include source citations

**Solutions**:

1. Check `kiloCode.chat.enableCitations` is true in settings
2. Ensure codebase is indexed: Run command `Kilo Code: Reindex Codebase`
3. Verify file permissions for project directory
4. Check AI Features output panel for errors

**Validation**: Run `Kilo Code: Show Citation Status` to verify citation system is active.

#### Edit Plans Not Generated

**Problem**: No edit suggestions when refactoring

**Solutions**:

1. Enable `kiloCode.editGuidance.enabled` in settings
2. Check if file types are supported
3. Ensure AST parsing is working: Run command `Kilo Code: Check AST Support`
4. Verify code-index service is running

**Validation**: Run `Kilo Code: Test Edit Guidance` with a simple code selection.

#### Slow Completions

**Problem**: Code completions are laggy

**Solutions**:

1. Reduce `kiloCode.completions.maxFiles` in settings
2. Increase `kiloCode.completions.debounceMs` to 500ms or higher
3. Disable semantic search if not needed
4. Clear cache: Run command `Kilo Code: Clear Cache`

**Validation**: Run `Kilo Code: Benchmark Completions` to measure performance.

#### Slack Integration Fails

**Problem**: Cannot connect to Slack workspace

**Solutions**:

1. Verify Slack app permissions
2. Check network connectivity
3. Re-authenticate: Run command `Kilo Code: Reconnect Slack`
4. Check AI Features output panel for error messages

**Validation**: Run `Kilo Code: Test Slack Connection` to verify connectivity.

### Debug Mode

Enable debug logging:

```json
{
	"kiloCode.performance.logLevel": "debug",
	"kiloCode.performance.enableLogging": true
}
```

View logs in VSCode output panel: `View → Output → AI Features`

**Available Commands**:

- `Kilo Code: Show AI Logs` - Display recent AI feature logs
- `Kilo Code: Export AI Logs` - Export logs to file for analysis
- `Kilo Code: Clear AI Logs` - Clear log history
- `Kilo Code: Show Performance Metrics` - Display performance statistics

## Performance Tips

### Large Codebases

1. **Incremental Indexing**: Enable to avoid full reindexing
    ```json
    {
    	"kiloCode.chat.autoSaveContext": true,
    	"kiloCode.completions.maxFiles": 30
    }
    ```
2. **File Exclusions**: Exclude large directories:
    ```json
    {
    	"kiloCode.index.exclude": ["node_modules/**", "dist/**", "*.min.js", "build/**"]
    }
    ```
3. **Context Limits**: Reduce context window for faster responses
    ```json
    {
    	"kiloCode.chat.maxContextFiles": 50,
    	"kiloCode.completions.contextWindowSize": 4000
    }
    ```

### Memory Usage

1. **Cache Management**: Clear cache periodically with `Kilo Code: Clear Cache`
2. **Background Processing**: Enable background indexing
3. **Resource Limits**: Set appropriate limits in settings

**Performance Monitoring**:

- Run `Kilo Code: Show Performance Metrics` to view current performance
- Run `Kilo Code: Generate Performance Report` for detailed analysis

## API Reference

### Chat API

```typescript
// Create session
const session = await kiloCode.chat.createSession({
	title: "Auth System Analysis",
	initialContext: {
		filePath: "/project/src/auth/index.ts",
		position: 0,
	},
})

// Send message
const response = await kiloCode.chat.sendMessage(session.id, {
	content: "How does authentication work?",
	includeCitations: true,
})
```

### Edit Guidance API

```typescript
// Create edit plan
const plan = await kiloCode.editGuidance.createPlan({
	title: "Refactor Auth Service",
	files: ["src/services/auth/*"],
	type: "refactor",
})

// Execute step
const result = await kiloCode.editGuidance.executeStep(plan.id, stepId)
```

### Completions API

```typescript
// Get completions
const completions = await kiloCode.completions.getCompletions({
	filePath: "/project/src/components/User.tsx",
	position: 150,
	context: {
		includeSemantic: true,
		maxFiles: 50,
	},
})
```

### Slack API

```typescript
// Share to Slack
const result = await kiloCode.slack.share({
	content: "Check out this analysis...",
	channelId: "#dev-team",
	format: "code-block",
})
```

## Support & Resources

- **Documentation**: https://docs.kilo.ai
- **Issues**: https://github.com/Kilo-Org/kilocode/issues
- **Community**: https://discord.gg/kilocode
- **Email**: support@kilo.ai

## Validation Checklist

Before using the advanced AI features, ensure:

- [ ] Extension is installed and activated
- [ ] AI provider is configured with valid API key
- [ ] All advanced features are enabled in settings
- [ ] AI services are initialized (check output panel)
- [ ] Codebase is indexed for citations
- [ ] (Optional) Slack integration is configured

Run command `Kilo Code: Validate Setup` to automatically check all requirements.

## Release Notes

### v4.144.0 (Current)

- ✅ Enhanced chat with source citations
- ✅ Next edit guidance system
- ✅ Context-aware completions
- ✅ Slack integration
- ✅ Performance improvements

### Upcoming Features

- 🔄 Multi-language support for edit guidance
- 🔄 Voice commands for chat
- 🔄 Advanced debugging assistance
- 🔄 Code review automation

---

**Happy coding with Kilo Code! 🚀**
