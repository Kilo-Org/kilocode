# Activation and Command System

The activation and command system handles VS Code extension lifecycle, command registration, code actions, and URI
handling. This system provides the interface between VS Code's extension API and the core extension functionality.

## Location

`src/activate/`

## Core Components

### index.ts

Main entry point that exports all activation-related functionality.

### registerCommands.ts

Handles registration of all VS Code commands and their implementations.

**Key Features:**

- **Command registration**: Registers all extension commands with VS Code
- **Panel management**: Manages sidebar and tab panel instances
- **Button handlers**: Implements title bar button functionality
- **Settings management**: Import/export and configuration commands

### CodeActionProvider.ts

Provides context-aware code actions in the VS Code editor.

**Key Features:**

- **Context-sensitive actions**: Different actions based on code context
- **Diagnostic integration**: Special actions for code with errors
- **Range detection**: Smart selection of relevant code ranges
- **Quick fixes**: Immediate code improvement suggestions

### registerCodeActions.ts

Registers code action commands and their handlers.

### registerTerminalActions.ts

Registers terminal-related actions and commands.

### handleUri.ts

Handles custom URI schemes for external integrations.

### handleTask.ts

Handles new task creation from various entry points.

## Command System Architecture

### Command Registration

```typescript
export const registerCommands = (options: RegisterCommandOptions) => {
	const { context } = options

	for (const [id, callback] of Object.entries(getCommandsMap(options))) {
		const command = getCommand(id as CommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}
}
```

### Command Map Structure

```typescript
const getCommandsMap = ({ context, outputChannel }: RegisterCommandOptions): Record<CommandId, any> => ({
	activationCompleted: () => {},
	accountButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) return

		TelemetryService.instance.captureTitleButtonClicked("account")
		visibleProvider.postMessageToWebview({
			type: "action",
			action: "accountButtonClicked",
		})
	},
	plusButtonClicked: async () => {
		// Handle new chat creation
	},
	// ... other commands
})
```

## Panel Management

### Panel Types

The system supports two panel modes:

#### Sidebar Panel

```typescript
let sidebarPanel: vscode.WebviewView | undefined = undefined
```

#### Tab Panel

```typescript
let tabPanel: vscode.WebviewPanel | undefined = undefined
```

### Panel Switching

```typescript
export function setPanel(
	newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
	type: "sidebar" | "tab",
): void {
	if (type === "sidebar") {
		sidebarPanel = newPanel as vscode.WebviewView
		tabPanel = undefined
	} else {
		tabPanel = newPanel as vscode.WebviewPanel
		sidebarPanel = undefined
	}
}
```

### Tab Creation

```typescript
export const openClineInNewTab = async ({ context, outputChannel }) => {
	const contextProxy = await ContextProxy.getInstance(context)
	const codeIndexManager = CodeIndexManager.getInstance(context)

	const tabProvider = new ClineProvider(context, outputChannel, "editor", contextProxy, codeIndexManager)

	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Kilo Code", targetCol, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [context.extensionUri],
	})

	await tabProvider.resolveWebviewView(newPanel)

	// Lock editor group to prevent file opening interference
	await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

	return tabProvider
}
```

## Code Actions System

### Code Action Provider

```typescript
export class CodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix,
		vscode.CodeActionKind.RefactorRewrite,
	]

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		const effectiveRange = EditorUtils.getEffectiveRange(document, range)
		if (!effectiveRange) return []

		const filePath = EditorUtils.getFilePath(document)
		const actions: vscode.CodeAction[] = []

		// Always available: Add to Context
		actions.push(
			this.createAction(TITLES.ADD_TO_CONTEXT, vscode.CodeActionKind.QuickFix, "addToContext", [
				filePath,
				effectiveRange.text,
				effectiveRange.range.start.line + 1,
				effectiveRange.range.end.line + 1,
			]),
		)

		// Context-sensitive actions
		if (context.diagnostics.length > 0) {
			// Show Fix action when there are diagnostics
			const relevantDiagnostics = context.diagnostics.filter((d) =>
				EditorUtils.hasIntersectingRange(effectiveRange.range, d.range),
			)

			if (relevantDiagnostics.length > 0) {
				actions.push(
					this.createAction(TITLES.FIX, vscode.CodeActionKind.QuickFix, "fixCode", [
						filePath,
						effectiveRange.text,
						effectiveRange.range.start.line + 1,
						effectiveRange.range.end.line + 1,
						relevantDiagnostics.map(EditorUtils.createDiagnosticData),
					]),
				)
			}
		} else {
			// Show Explain and Improve actions when no diagnostics
			actions.push(
				this.createAction(TITLES.EXPLAIN, vscode.CodeActionKind.QuickFix, "explainCode", [
					filePath,
					effectiveRange.text,
					effectiveRange.range.start.line + 1,
					effectiveRange.range.end.line + 1,
				]),
			)

			actions.push(
				this.createAction(TITLES.IMPROVE, vscode.CodeActionKind.QuickFix, "improveCode", [
					filePath,
					effectiveRange.text,
					effectiveRange.range.start.line + 1,
					effectiveRange.range.end.line + 1,
				]),
			)
		}

		return actions
	}
}
```

### Code Action Types

```typescript
export const TITLES: Record<CodeActionName, string> = {
	EXPLAIN: "Explain with Kilo Code",
	FIX: "Fix with Kilo Code",
	IMPROVE: "Improve with Kilo Code",
	ADD_TO_CONTEXT: "Add to Kilo Code",
	NEW_TASK: "New Kilo Code Task",
}
```

### Code Action Registration

```typescript
const registerCodeAction = (context: vscode.ExtensionContext, command: CodeActionId, promptType: CodeActionName) => {
	context.subscriptions.push(
		vscode.commands.registerCommand(getCodeActionCommand(command), async (...args: any[]) => {
			let filePath: string
			let selectedText: string
			let startLine: number | undefined
			let endLine: number | undefined
			let diagnostics: any[] | undefined

			if (args.length > 1) {
				// Called from code action
				;[filePath, selectedText, startLine, endLine, diagnostics] = args
			} else {
				// Called directly from command palette
				const context = EditorUtils.getEditorContext()
				if (!context) return
				;({ filePath, selectedText, startLine, endLine, diagnostics } = context)
			}

			const params = {
				filePath,
				selectedText,
				...(startLine !== undefined ? { startLine: startLine.toString() } : {}),
				...(endLine !== undefined ? { endLine: endLine.toString() } : {}),
				...(diagnostics ? { diagnostics } : {}),
			}

			await ClineProvider.handleCodeAction(command, promptType, params)
		}),
	)
}
```

## Terminal Integration

### Terminal Actions

```typescript
export const registerTerminalActions = (context: vscode.ExtensionContext) => {
	registerTerminalAction(context, "terminalAddToContext", "TERMINAL_ADD_TO_CONTEXT")
	registerTerminalAction(context, "terminalFixCommand", "TERMINAL_FIX")
	registerTerminalAction(context, "terminalExplainCommand", "TERMINAL_EXPLAIN")
}
```

### Terminal Action Handler

```typescript
const registerTerminalAction = (
	context: vscode.ExtensionContext,
	command: TerminalActionId,
	promptType: TerminalActionPromptType,
) => {
	context.subscriptions.push(
		vscode.commands.registerCommand(getTerminalCommand(command), async (args: any) => {
			let content = args?.selection

			if (!content || content === "") {
				content = await Terminal.getTerminalContents(promptType === "TERMINAL_ADD_TO_CONTEXT" ? -1 : 1)
			}

			if (!content) {
				vscode.window.showWarningMessage(t("common:warnings.no_terminal_content"))
				return
			}

			await ClineProvider.handleTerminalAction(command, promptType, {
				terminalContent: content,
			})
		}),
	)
}
```

## URI Handling

### Custom URI Schemes

```typescript
export const handleUri = async (uri: vscode.Uri) => {
	const path = uri.path
	const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
	const visibleProvider = ClineProvider.getVisibleInstance()

	if (!visibleProvider) return

	switch (path) {
		case "/glama": {
			const code = query.get("code")
			if (code) {
				await visibleProvider.handleGlamaCallback(code)
			}
			break
		}
		case "/openrouter": {
			const code = query.get("code")
			if (code) {
				await visibleProvider.handleOpenRouterCallback(code)
			}
			break
		}
		case "/kilocode": {
			const token = query.get("token")
			if (token) {
				await visibleProvider.handleKiloCodeCallback(token)
			}
			break
		}
		case "/auth/clerk/callback": {
			const code = query.get("code")
			const state = query.get("state")
			const organizationId = query.get("organizationId")

			await CloudService.instance.handleAuthCallback(
				code,
				state,
				organizationId === "null" ? null : organizationId,
			)
			break
		}
	}
}
```

### OAuth Integration

The URI handler supports OAuth flows for various services:

- **Glama**: AI model provider authentication
- **OpenRouter**: API access authentication
- **KiloCode**: Service authentication
- **Clerk**: User authentication service

## Task Handling

### New Task Creation

```typescript
export const handleNewTask = async (params: { prompt?: string } | null | undefined) => {
	let prompt = params?.prompt

	if (!prompt) {
		prompt = await vscode.window.showInputBox({
			prompt: t("common:input.task_prompt"),
			placeHolder: t("common:input.task_placeholder"),
		})
	}

	if (!prompt) {
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		return
	}

	await ClineProvider.handleCodeAction("newTask", "NEW_TASK", { userInput: prompt })
}
```

## Button Handlers

### Title Bar Buttons

The system provides handlers for various title bar buttons:

#### Account Button

```typescript
accountButtonClicked: () => {
	const visibleProvider = getVisibleProviderOrLog(outputChannel)
	if (!visibleProvider) return

	TelemetryService.instance.captureTitleButtonClicked("account")
	visibleProvider.postMessageToWebview({
		type: "action",
		action: "accountButtonClicked",
	})
}
```

#### Plus Button (New Chat)

```typescript
plusButtonClicked: async () => {
	const visibleProvider = getVisibleProviderOrLog(outputChannel)
	if (!visibleProvider) return

	TelemetryService.instance.captureTitleButtonClicked("plus")

	await visibleProvider.removeClineFromStack()
	await visibleProvider.postStateToWebview()
	await visibleProvider.postMessageToWebview({
		type: "action",
		action: "chatButtonClicked",
	})
}
```

#### Settings Button

```typescript
settingsButtonClicked: () => {
	const visibleProvider = getVisibleProviderOrLog(outputChannel)
	if (!visibleProvider) return

	TelemetryService.instance.captureTitleButtonClicked("settings")

	visibleProvider.postMessageToWebview({
		type: "action",
		action: "settingsButtonClicked",
	})
	visibleProvider.postMessageToWebview({
		type: "action",
		action: "didBecomeVisible",
	})
}
```

## Integration Points

### ClineProvider Integration

All commands ultimately interact with the ClineProvider:

```typescript
const visibleProvider = getVisibleProviderOrLog(outputChannel)
if (!visibleProvider) return

// Execute provider method or send webview message
await visibleProvider.someMethod()
// or
visibleProvider.postMessageToWebview({ type: "action", action: "someAction" })
```

### Telemetry Integration

Commands include telemetry tracking:

```typescript
TelemetryService.instance.captureTitleButtonClicked("buttonName")
```

### Configuration Integration

Commands respect user configuration:

```typescript
if (!vscode.workspace.getConfiguration(Package.name).get<boolean>("enableCodeActions", true)) {
	return []
}
```

## Error Handling

### Provider Validation

```typescript
export function getVisibleProviderOrLog(outputChannel: vscode.OutputChannel): ClineProvider | undefined {
	const visibleProvider = ClineProvider.getVisibleInstance()
	if (!visibleProvider) {
		outputChannel.appendLine("Cannot find any visible Kilo Code instances.")
		return undefined
	}
	return visibleProvider
}
```

### Command Error Handling

```typescript
try {
	// Command execution
} catch (error) {
	console.error("Error providing code actions:", error)
	return []
}
```

## Configuration and Settings

### Extension Configuration

Commands can be enabled/disabled through VS Code settings:

```json
{
	"kilo-code.enableCodeActions": true,
	"kilo-code.enableTerminalActions": true
}
```

### Command Availability

Commands are conditionally available based on:

- Extension activation state
- Current editor context
- User permissions and settings
- Provider availability

## Testing

### Unit Tests

- **Command registration**: Verify all commands are properly registered
- **Code action logic**: Test code action generation and filtering
- **URI handling**: Test various URI schemes and parameters
- **Error scenarios**: Test error handling and edge cases

### Integration Tests

- **End-to-end workflows**: Test complete command execution flows
- **VS Code integration**: Test integration with VS Code APIs
- **Provider interaction**: Test communication with ClineProvider
- **Telemetry**: Verify telemetry events are properly captured

## Future Enhancements

- **Dynamic command registration**: Register commands based on context
- **Enhanced code actions**: More sophisticated code analysis
- **Keyboard shortcuts**: Configurable keyboard shortcuts for commands
- **Command palette integration**: Better command palette experience
- **Context menu integration**: Additional context menu options
