import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

export interface ToolInfo {
	name: string
	description: string
	inputSchema?: object
	tags?: readonly string[]
	displayName?: string
	userDescription?: string
	icon?: string
	providerExtensionId: string
	providerExtensionDisplayName: string
	toolReferenceName?: string
	canBeReferencedInPrompt?: boolean
}

export class ToolTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly extensionId?: string,
		public readonly toolName?: string,
		description?: string,
		isSelected: boolean = false,
	) {
		super(label, collapsibleState)

		this.description = description

		// Set properties based on whether this is a group or tool item
		if (extensionId && !toolName) {
			// This is a group item
			this.contextValue = "toolGroup"
			this.iconPath = new vscode.ThemeIcon("extensions")
			this.checkboxState = isSelected
				? vscode.TreeItemCheckboxState.Checked
				: vscode.TreeItemCheckboxState.Unchecked
			this.tooltip = `${extensionId}\n${description || ""}`
		} else if (toolName) {
			// This is a tool item
			this.contextValue = "tool"
			this.iconPath = new vscode.ThemeIcon("tools")
			this.description = description
			this.checkboxState = isSelected
				? vscode.TreeItemCheckboxState.Checked
				: vscode.TreeItemCheckboxState.Unchecked
			this.tooltip = description
		}
	}
}

export class VSCLMToolsService implements vscode.TreeDataProvider<ToolTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ToolTreeItem | undefined | null | void> = new vscode.EventEmitter<
		ToolTreeItem | undefined | null | void
	>()
	readonly onDidChangeTreeData: vscode.Event<ToolTreeItem | undefined | null | void> = this._onDidChangeTreeData.event

	// Internal cache for grouped tool info
	private groupedTools: Record<string, { extensionDisplayName: string; tools: ToolInfo[] }> = {}
	private initialized = false
	private toolSelectionState: Record<string, boolean> = {}
	private saveSelectionsTimeout: NodeJS.Timeout | null = null
	private treeView: vscode.TreeView<ToolTreeItem>

	constructor(private readonly context: vscode.ExtensionContext) {
		// Initialize tool discovery
		this.ensureInitialized()

		// Load initial selections
		this.loadSelections().then(() => this.refresh())

		// Register to save selections on deactivation
		context.subscriptions.push({
			dispose: () => {
				if (this.saveSelectionsTimeout) {
					clearTimeout(this.saveSelectionsTimeout)
					this.saveSelectionsNow()
				}
			},
		})

		const treeView = vscode.window.createTreeView("kilo-tool-selection", {
			treeDataProvider: this,
			canSelectMany: true,
		})
		this.treeView = treeView
		context.subscriptions.push(treeView)
		treeView.onDidChangeCheckboxState((e) => {
			// Persist the changes with some debouncing
			for (const [item, state] of e.items) {
				if (item.toolName) {
					const isChecked = state === vscode.TreeItemCheckboxState.Checked
					this.toolSelectionState[item.toolName] = isChecked
				}
			}
			this.debouncedSaveSelections()
			this.updateTreeViewTitle()
		})

		// Register the approval mode commands
		const setManualApprovalCommand = vscode.commands.registerCommand("kilo-code.setManualApproval", () =>
			this.setApprovalMode(false),
		)
		const setAutoApprovalCommand = vscode.commands.registerCommand("kilo-code.setAutoApproval", () =>
			this.setApprovalMode(true),
		)
		const addMoreToolsCommand = vscode.commands.registerCommand("kilo-code.addMoreTools", () =>
			this.openExtensionsWithToolsFilter(),
		)
		context.subscriptions.push(setManualApprovalCommand, setAutoApprovalCommand, addMoreToolsCommand)
	}

	private scanExtensionsForTools(): void {
		const result: Record<string, { extensionDisplayName: string; tools: ToolInfo[] }> = {}
		for (const ext of vscode.extensions.all) {
			const pkg = ext.packageJSON
			const lmTools = pkg?.contributes?.languageModelTools
			if (Array.isArray(lmTools)) {
				result[ext.id] = {
					extensionDisplayName: pkg.displayName || ext.id,
					tools: lmTools.map((tool: any) => ({
						name: tool.name,
						description: tool.modelDescription || tool.description || "",
						inputSchema: tool.inputSchema,
						tags: tool.tags,
						displayName: tool.displayName,
						userDescription: tool.userDescription,
						icon: tool.icon,
						providerExtensionId: ext.id,
						providerExtensionDisplayName: pkg.displayName || ext.id,
						toolReferenceName: tool.toolReferenceName,
						canBeReferencedInPrompt: tool.canBeReferencedInPrompt,
					})),
				}
			}
		}
		this.groupedTools = result
	}

	private ensureInitialized(): void {
		if (!this.initialized) {
			this.scanExtensionsForTools()
			// Listen for extension changes to keep tool info up to date
			vscode.extensions.onDidChange(() => {
				this.scanExtensionsForTools()
				this.refresh()
			})
			this.initialized = true
		}
	}

	// Public methods for tool management

	getAllToolsGroupedByExtension(): Record<string, { extensionDisplayName: string; tools: ToolInfo[] }> {
		this.ensureInitialized()
		return this.groupedTools
	}

	getSelectedTools(): ToolInfo[] {
		this.ensureInitialized()
		const selectedTools: ToolInfo[] = []

		for (const [extensionId, { tools }] of Object.entries(this.groupedTools)) {
			for (const tool of tools) {
				if (this.toolSelectionState[tool.name]) {
					selectedTools.push(tool)
				}
			}
		}

		return selectedTools
	}

	isToolSelected(toolName: string): boolean {
		return this.toolSelectionState[toolName] || false
	}

	private getSelectionFilePath(): string {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return ""
		}
		return path.join(workspaceFolders[0].uri.fsPath, ".roo", "tools", "selection.yaml")
	}

	private async ensureDirectoryExists(filePath: string): Promise<void> {
		const dir = path.dirname(filePath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
	}

	private async loadSelections(): Promise<void> {
		const filePath = this.getSelectionFilePath()
		if (!filePath) return

		try {
			await this.ensureDirectoryExists(filePath)
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, "utf-8")
				const state = yaml.parse(content) || {}

				if (typeof state === "object" && !Array.isArray(state)) {
					this.toolSelectionState = state
				} else {
					// default to none selected
					this.toolSelectionState = {}
				}
			}
		} catch (error) {
			console.error("Error reading tool selections:", error)
		}
	}

	private debouncedSaveSelections(): void {
		if (this.saveSelectionsTimeout) {
			clearTimeout(this.saveSelectionsTimeout)
		}

		this.saveSelectionsTimeout = setTimeout(() => {
			this.saveSelectionsNow()
		}, 5000)
	}

	private async saveSelectionsNow(): Promise<void> {
		const filePath = this.getSelectionFilePath()
		if (!filePath) return

		try {
			await this.ensureDirectoryExists(filePath)
			fs.writeFileSync(filePath, yaml.stringify(this.toolSelectionState))
		} catch (error) {
			console.error("Error writing tool selections:", error)
		} finally {
			this.saveSelectionsTimeout = null
		}
	}

	invokeTool(toolName: string, input: object, token?: vscode.CancellationToken): Thenable<vscode.LanguageModelToolResult> {
		const tool = this.getToolInfoByName(toolName)
		if (!tool) {
			throw new Error(`Tool '${toolName}' not found`)
		}

		const invocationToken = undefined // We're not in a chat context, so no token
		const options = {
			input,
			toolInvocationToken: invocationToken,
		}

		// Execute the tool
		return vscode.lm.invokeTool(toolName, options, token)
	}

	async prepareToolInvocation(
		toolName: string,
		input: object,
		token?: vscode.CancellationToken,
	): Promise<vscode.PreparedToolInvocation | undefined> {
		return undefined

		// const tool = this.getToolInfoByName(toolName)
		// if (!tool || typeof tool.prepareInvocation !== 'function') {
		//     return undefined
		// }

		// const options = {
		//     input,
		//     toolInvocationToken: undefined // No chat context token
		// }

		// // Let the tool prepare its invocation
		// const prepared = await tool.prepareInvocation(options, token)
		// return prepared
	}

	private getToolInfoByName(toolName: string): vscode.LanguageModelToolInformation | undefined {
		return vscode.lm.tools.find((t) => t.name === toolName)
	}

	// TreeDataProvider implementation

	refresh(): void {
		this._onDidChangeTreeData.fire()
		this.updateTreeViewTitle()
	}

	getTreeItem(element: ToolTreeItem): vscode.TreeItem {
		if (element.toolName) {
			element.checkboxState = this.toolSelectionState[element.toolName]
				? vscode.TreeItemCheckboxState.Checked
				: vscode.TreeItemCheckboxState.Unchecked
		} else if (element.extensionId) {
			const { extensionDisplayName } = this.groupedTools[element.extensionId]
			element.label = extensionDisplayName
		}
		return element
	}

	getChildren(element?: ToolTreeItem): ToolTreeItem[] {
		if (!element) {
			// Root level - return extension groups
			const groupedTools = this.getAllToolsGroupedByExtension()
			const items: ToolTreeItem[] = []

			for (const [extensionId, { extensionDisplayName, tools }] of Object.entries(groupedTools)) {
				if (tools.length === 0) continue

				const groupSelectedCount = tools.filter((t) => this.toolSelectionState[t.name]).length
				const allSelected = groupSelectedCount === tools.length

				const groupItem = new ToolTreeItem(
					`${extensionDisplayName} (${groupSelectedCount}/${tools.length})`,
					vscode.TreeItemCollapsibleState.Expanded,
					extensionId,
					undefined,
					undefined,
					allSelected,
				)
				items.push(groupItem)
			}
			return items
		} else if (element.extensionId) {
			// Extension group level - return tools
			const { tools } = this.groupedTools[element.extensionId]

			return tools.map(
				(tool) =>
					new ToolTreeItem(
						tool.displayName || tool.name,
						vscode.TreeItemCollapsibleState.None,
						element.extensionId,
						tool.name,
						tool.description,
						this.toolSelectionState[tool.name],
					),
			)
		}
		return []
	}

	async setApprovalMode(autoApprove: boolean): Promise<void> {
		try {
			// Get current setting value
			const config = vscode.workspace.getConfiguration()
			const currentValue = config.get<boolean>("chat.tools.autoApprove", false)

			// Only update if value is different
			if (autoApprove !== currentValue) {
				// Update the configuration
				await config.update("chat.tools.autoApprove", autoApprove, vscode.ConfigurationTarget.Workspace)

				const mode = autoApprove ? "Auto" : "Manual"
				vscode.window.showInformationMessage(`Tool approval mode: ${mode}`)

				// Update tree view title to reflect new state
				this.updateTreeViewTitle()
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			vscode.window.showErrorMessage(`Failed to update approval mode: ${errorMessage}`)
		}
	}

	private updateTreeViewTitle(): void {
		const config = vscode.workspace.getConfiguration()
		const autoApprove = config.get<boolean>("chat.tools.autoApprove", false)
		const approvalMode = autoApprove ? "Auto" : "Manual"
		const selectedCount = this.getSelectedTools().length
		const totalCount = Object.values(this.groupedTools).reduce((sum, group) => sum + group.tools.length, 0)

		this.treeView.title = `Tool Selection (${selectedCount}/${totalCount}) - ${approvalMode} Approval`
	}

	private async openExtensionsWithToolsFilter(): Promise<void> {
		try {
			await vscode.commands.executeCommand("workbench.extensions.search", "@tag:language-model-tools")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			vscode.window.showErrorMessage(`Failed to open extensions view: ${errorMessage}`)
		}
	}
}
