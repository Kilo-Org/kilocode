import * as vscode from "vscode"
import { VisualizationType } from "./VisualizationType"
import { VisualizationContext, AutocompleteVisualizationResponse } from "./types/VisualizationData"
import { buildApiHandler } from "../../../api"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { XMLParser } from "fast-xml-parser"
import { PredictedEditVisualization } from "./visualizations/PredictedEditVisualization"
import { CursorJumpVisualization } from "./visualizations/CursorJumpVisualization"
import { RelatedFileVisualization } from "./visualizations/RelatedFileVisualization"
import { LLMToolSystem } from "@roo-code/typed-llm-stream"
import { CursorJumpTool, PredictedEditTool, RelatedFileTool } from "./tools/VisualizationTools"

/**
 * Main controller class for experimental autocomplete visualizations
 * Manages the lifecycle of experimental visualizations and coordinates between them
 */
export class ExperimentalAutocompleteVisualizer implements vscode.Disposable {
	private static instance: ExperimentalAutocompleteVisualizer
	private visualizations: Map<string, VisualizationType> = new Map()
	private activeVisualizations: Set<string> = new Set()
	private statusBarItem: vscode.StatusBarItem
	private isActive: boolean = false
	private disposables: vscode.Disposable[] = []
	private lastResponseTime: number = 0
	private responseDebounceMs: number = 500 // Debounce time for model responses
	private debouncedRequestPredictions: (
		...args: [VisualizationContext]
	) => Promise<AutocompleteVisualizationResponse | null>

	// LLM tools for visualizations
	private cursorJumpTool: CursorJumpTool
	private predictedEditTool: PredictedEditTool
	private relatedFileTool: RelatedFileTool
	private llmToolSystem: LLMToolSystem

	// Default model for experimental visualizations
	private readonly defaultModel = "google/gemini-2.5-flash-preview-05-20"

	/**
	 * Get the singleton instance of the visualizer
	 */
	public static getInstance(): ExperimentalAutocompleteVisualizer {
		if (!ExperimentalAutocompleteVisualizer.instance) {
			ExperimentalAutocompleteVisualizer.instance = new ExperimentalAutocompleteVisualizer()
		}
		return ExperimentalAutocompleteVisualizer.instance
	}

	/**
	 * Private constructor to enforce singleton pattern
	 */
	private constructor() {
		// Create status bar item
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
		this.statusBarItem.text = "$(beaker) Kilo-viz"
		this.statusBarItem.tooltip = "Experimental Autocomplete Visualizations"
		this.statusBarItem.command = "kilo-code.triggerExperimentalAutocomplete"
		this.updateStatusBar()

		// Initialize LLM tools
		this.cursorJumpTool = new CursorJumpTool()
		this.predictedEditTool = new PredictedEditTool()
		this.relatedFileTool = new RelatedFileTool()

		// Initialize LLM tool system
		this.llmToolSystem = new LLMToolSystem({
			tools: [this.cursorJumpTool, this.predictedEditTool, this.relatedFileTool],
			globalContext: {},
		})

		// Set up tool response handlers
		this.setupToolResponseHandlers()

		// Create debounced function for model requests
		const { createDebouncedFn } = require("../utils/createDebouncedFn")
		this.debouncedRequestPredictions = createDebouncedFn(
			this._requestPredictions.bind(this),
			500, // 500ms debounce
		)

		// Set up event listeners
		this.disposables.push(
			vscode.window.onDidChangeTextEditorSelection(this.handleSelectionChange.bind(this)),
			vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange.bind(this)),
			this.statusBarItem,
		)
	}

	/**
	 * Set up handlers for LLM tool responses
	 */
	private setupToolResponseHandlers() {
		// Handle cursor jump responses
		this.cursorJumpTool.handleResponse = async (data, context) => {
			const response: AutocompleteVisualizationResponse = {
				cursorJumps: data,
			}

			// Handle response in active visualizations
			for (const id of this.activeVisualizations) {
				const visualization = this.visualizations.get(id)
				if (visualization && visualization.id === "cursor-jump") {
					await visualization.handleResponse(response)
				}
			}

			return data
		}

		// Handle predicted edit responses
		this.predictedEditTool.handleResponse = async (data, context) => {
			const response: AutocompleteVisualizationResponse = {
				predictedEdits: data,
			}

			// Handle response in active visualizations
			for (const id of this.activeVisualizations) {
				const visualization = this.visualizations.get(id)
				if (visualization && visualization.id === "predicted-edit") {
					await visualization.handleResponse(response)
				}
			}

			return data
		}

		// Handle related file responses
		this.relatedFileTool.handleResponse = async (data, context) => {
			const response: AutocompleteVisualizationResponse = {
				relatedFiles: data,
			}

			// Handle response in active visualizations
			for (const id of this.activeVisualizations) {
				const visualization = this.visualizations.get(id)
				if (visualization && visualization.id === "related-file") {
					await visualization.handleResponse(response)
				}
			}

			return data
		}
	}

	/**
	 * Register a visualization type with the visualizer
	 */
	public registerVisualization(visualization: VisualizationType): void {
		console.log(`🚀🔮 Registering visualization: ${visualization.id} - ${visualization.name}`)
		this.visualizations.set(visualization.id, visualization)
		this.updateStatusBar()
	}

	/**
	 * Toggle the visualizer on/off
	 */
	public async toggle(): Promise<void> {
		this.isActive = !this.isActive
		console.log(`🚀🔮 Experimental visualizations ${this.isActive ? "enabled" : "disabled"}`)

		if (this.isActive) {
			this.statusBarItem.show()
			vscode.window.showInformationMessage("Experimental autocomplete visualizations enabled")

			// If no visualizations are active, enable predicted edits by default
			if (this.activeVisualizations.size === 0) {
				console.log(`🚀🔮 No active visualizations, enabling predicted edits by default`)
				// Find the predicted-edit visualization and enable it
				const predictedEditViz = this.visualizations.get("predicted-edit")
				if (predictedEditViz) {
					this.activeVisualizations.add("predicted-edit")
					await predictedEditViz.activate()
					// console.log(`🚀🔮 Predicted edits visualization enabled by default`)
				} else {
					// console.log(`🚀🔮 Predicted edits visualization not found, showing picker`)
					await this.showVisualizationPicker()
				}
			} else {
				console.log(`🚀🔮 Activating ${this.activeVisualizations.size} visualizations`)
				await this.activateSelectedVisualizations()
			}
		} else {
			console.log(`🚀🔮 Deactivating all visualizations`)
			await this.deactivateAllVisualizations()
			vscode.window.showInformationMessage("Experimental autocomplete visualizations disabled")
		}

		this.updateStatusBar()
	}

	/**
	 * Toggle a specific visualization on/off
	 */
	public async toggleVisualization(id: string): Promise<void> {
		if (!this.isActive) {
			await this.toggle()
		}

		if (this.activeVisualizations.has(id)) {
			this.activeVisualizations.delete(id)
			const visualization = this.visualizations.get(id)
			if (visualization) {
				await visualization.deactivate()
			}
		} else {
			this.activeVisualizations.add(id)
			const visualization = this.visualizations.get(id)
			if (visualization) {
				await visualization.activate()
			}
		}

		this.updateStatusBar()
	}

	/**
	 * Show a quick pick to select which visualizations to enable
	 */
	public async showVisualizationPicker(): Promise<void> {
		const items = Array.from(this.visualizations.values()).map((v) => ({
			label: v.name,
			description: v.description,
			picked: this.activeVisualizations.has(v.id),
			id: v.id,
		}))

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: "Select visualizations to enable",
		})

		if (selected) {
			// Deactivate all visualizations first
			await this.deactivateAllVisualizations()

			// Clear and update active visualizations
			this.activeVisualizations.clear()
			selected.forEach((item) => {
				this.activeVisualizations.add(item.id)
			})

			// Activate selected visualizations
			if (this.isActive) {
				await this.activateSelectedVisualizations()
			}

			this.updateStatusBar()
		}
	}

	/**
	 * Trigger visualizations for the current context
	 */
	public async triggerVisualizations(): Promise<void> {
		if (!this.isActive || this.activeVisualizations.size === 0) {
			return
		}

		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		console.log(`🚀🔮 Triggering visualizations at ${new Date().toISOString()}`)

		const document = editor.document
		const position = editor.selection.active
		console.log(`🚀🔮 Current position: ${document.uri.fsPath}:${position.line + 1}:${position.character + 1}`)

		// Update all active visualizations
		for (const id of this.activeVisualizations) {
			const visualization = this.visualizations.get(id)
			if (visualization) {
				console.log(`🚀🔮 Updating visualization: ${id}`)
				await visualization.update(document, position, editor)
			}
		}

		// Get visualization context
		const context = this.getVisualizationContext(document, position)
		console.log(`🚀🔮 Got context with ${context.recentEdits?.length || 0} lines of context`)

		// Request predictions from the model using debounced function
		console.log(`🚀🔮 Requesting predictions (debounced)`)
		const response = await this.debouncedRequestPredictions(context)

		if (response) {
			this.lastResponseTime = Date.now()
			console.log(`🚀🔮 Got response with:
				- Cursor jumps: ${response.cursorJumps?.length || 0}
				- Predicted edits: ${response.predictedEdits?.length || 0}
				- Related files: ${response.relatedFiles?.length || 0}
			`)

			// Handle response in all active visualizations
			for (const id of this.activeVisualizations) {
				const visualization = this.visualizations.get(id)
				if (visualization) {
					console.log(`🚀🔮 Handling response in visualization: ${id}`)
					await visualization.handleResponse(response)
				}
			}
		} else {
			console.log(`🚀🔮 No response received from model (likely debounced)`)
		}
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		this.deactivateAllVisualizations()
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.visualizations.forEach((v) => v.dispose())
		this.visualizations.clear()
	}

	/**
	 * Handle selection change events
	 */
	private async handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
		// Clear all decorations immediately when cursor moves
		await this.clearAllDecorations()

		// Then trigger new visualizations
		await this.triggerVisualizations()
	}

	/**
	 * Clear all decorations in all active visualizations
	 */
	private async clearAllDecorations(): Promise<void> {
		for (const id of this.activeVisualizations) {
			const visualization = this.visualizations.get(id)
			if (visualization) {
				// All visualization classes now have a public clearDecorations method
				if (id === "predicted-edit") {
					;(visualization as PredictedEditVisualization).clearDecorations()
				} else if (id === "cursor-jump") {
					;(visualization as CursorJumpVisualization).clearDecorations()
				} else if (id === "related-file") {
					;(visualization as RelatedFileVisualization).clearDecorations()
				}
			}
		}
	}

	/**
	 * Handle document change events
	 */
	private async handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
		const editor = vscode.window.activeTextEditor
		if (!editor || editor.document !== event.document) {
			return
		}

		// Clear all decorations immediately when document changes
		await this.clearAllDecorations()

		// Then trigger new visualizations
		await this.triggerVisualizations()
	}

	/**
	 * Activate all selected visualizations
	 */
	private async activateSelectedVisualizations(): Promise<void> {
		for (const id of this.activeVisualizations) {
			const visualization = this.visualizations.get(id)
			if (visualization) {
				await visualization.activate()
			}
		}
	}

	/**
	 * Deactivate all visualizations
	 */
	private async deactivateAllVisualizations(): Promise<void> {
		for (const [id, visualization] of this.visualizations.entries()) {
			await visualization.deactivate()
		}
	}

	/**
	 * Update the status bar item
	 */
	private updateStatusBar(): void {
		if (!this.isActive) {
			this.statusBarItem.text = "$(beaker) Kilo-viz"
			this.statusBarItem.tooltip = "Experimental Autocomplete Visualizations (disabled)"
			this.statusBarItem.hide()
			return
		}

		const activeCount = this.activeVisualizations.size
		const totalCount = this.visualizations.size

		this.statusBarItem.text = `$(beaker) Kilo-viz (${activeCount}/${totalCount})`

		const activeNames = Array.from(this.activeVisualizations)
			.map((id) => this.visualizations.get(id)?.name)
			.filter(Boolean)
			.join(", ")

		this.statusBarItem.tooltip = `Experimental Autocomplete Visualizations\nActive: ${activeNames || "None"}`
		this.statusBarItem.show()
	}

	/**
	 * Get context for visualization predictions
	 */
	private getVisualizationContext(document: vscode.TextDocument, position: vscode.Position): VisualizationContext {
		// Get open files
		const openFiles = vscode.window.visibleTextEditors.map((editor) => editor.document.uri.fsPath)

		// Get recent edits (could be enhanced to track actual edits)
		const recentEdits: string[] = []

		// Try to get some context from the document
		try {
			// Get the current line
			const currentLine = document.lineAt(position.line).text

			// Get a few lines before and after the current position
			const startLine = Math.max(0, position.line - 5)
			const endLine = Math.min(document.lineCount - 1, position.line + 5)

			for (let i = startLine; i <= endLine; i++) {
				if (i === position.line) {
					// Mark the current line
					recentEdits.push(`> ${document.lineAt(i).text}`)
				} else {
					recentEdits.push(`  ${document.lineAt(i).text}`)
				}
			}
		} catch (error) {
			console.error("Error getting document context:", error)
		}

		return {
			currentFile: document.uri.fsPath,
			currentPosition: position,
			openFiles,
			recentEdits,
		}
	}

	/**
	 * Request predictions from the model (internal implementation)
	 * This is wrapped by the debounced function
	 */
	private async _requestPredictions(context: VisualizationContext): Promise<AutocompleteVisualizationResponse> {
		try {
			console.log("🚀🔮 Requesting experimental autocomplete predictions")

			// Get API handler
			const apiHandler = buildApiHandler({
				apiProvider: "kilocode",
				kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
				kilocodeModel: this.defaultModel,
			})

			// Update tool system context
			this.llmToolSystem.updateGlobalContext({
				...context,
				activeVisualizations: Array.from(this.activeVisualizations),
			})

			// Enable/disable tools based on active visualizations
			if (this.activeVisualizations.has("cursor-jump")) {
				this.cursorJumpTool.enable()
			} else {
				this.cursorJumpTool.disable()
			}

			if (this.activeVisualizations.has("predicted-edit")) {
				this.predictedEditTool.enable()
			} else {
				this.predictedEditTool.disable()
			}

			if (this.activeVisualizations.has("related-file")) {
				this.relatedFileTool.enable()
			} else {
				this.relatedFileTool.disable()
			}

			// Generate system prompt using the tool system
			const systemPrompt = this.llmToolSystem.generateSystemPrompt()

			// Build user prompt
			const userPrompt = this.buildUserPrompt(context)

			console.log("🚀🔮 Sending prompt to model:", { systemPrompt, userPrompt })

			// Request predictions
			const stream = apiHandler.createMessage(systemPrompt, [
				{ role: "user", content: [{ type: "text", text: userPrompt }] },
			])

			// Create a combined response object
			const response: AutocompleteVisualizationResponse = {}

			// Convert ApiStream to string chunks for the LLM tool system
			let responseText = ""

			// First collect the full response
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					responseText += chunk.text
				}
			}

			console.log("🚀🔮 Received response from model:", responseText)

			// Process the complete response with the LLM tool system
			const results = await this.llmToolSystem.processCompleteResponse(responseText)

			for (const result of results) {
				console.log(`🚀🔮 Processed tool result for: ${result.toolId}`)
			}

			// The individual tool handlers will update the visualizations directly
			// Return an empty response since the tools handle their own responses
			return response
		} catch (error) {
			console.error("Error requesting predictions:", error)
			// Return empty response on error
			return {}
		}
	}

	/**
	 * Get system prompt for experimental visualizations
	 * This method is kept for backward compatibility but now delegates to the LLMToolSystem
	 */
	private getSystemPrompt(): string {
		return this.llmToolSystem.generateSystemPrompt()
	}

	/**
	 * Build user prompt for experimental visualizations
	 */
	private buildUserPrompt(context: VisualizationContext): string {
		// Get the current file content
		let fileContent = ""
		try {
			const document = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === context.currentFile)
			if (document) {
				fileContent = document.getText()
			}
		} catch (error) {
			console.error("Error getting file content:", error)
		}

		return `
Current file: ${context.currentFile}
Current position: Line ${context.currentPosition.line + 1}, Column ${context.currentPosition.character + 1}

${context.openFiles && context.openFiles.length > 0 ? `Open files:\n${context.openFiles.join("\n")}` : ""}

${context.recentEdits && context.recentEdits.length > 0 ? `Current context:\n${context.recentEdits.join("\n")}\n` : ""}

Current file content:
\`\`\`
${fileContent}
\`\`\`

Based on the current context and recent activity, analyze the code and provide helpful suggestions.
Focus on the most likely and helpful predictions based on common coding patterns and the current task context.
`
	}

	/**
	 * Parse response from the model
	 * This method is kept for backward compatibility but is no longer used
	 * since we're now using the LLMToolSystem to handle the parsing
	 */
	private parseResponse(responseText: string): AutocompleteVisualizationResponse {
		console.log("🚀🔮 parseResponse is deprecated, using LLMToolSystem instead")
		// Return empty response since the LLMToolSystem handles the parsing
		return {}
	}
}
