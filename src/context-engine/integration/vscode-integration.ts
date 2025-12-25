/**
 * VS Code Extension integration for Context Engine
 */

import * as vscode from "vscode"
import { getContextEngine } from "../index"
import type { ContextEngine } from "../index"
import type { VectorSearchResult } from "../types"
import { ContextEngineSettingsProvider } from "../ui/settings-provider"

/**
 * Initialize Context Engine for VS Code extension
 */
export async function activateContextEngine(context: vscode.ExtensionContext): Promise<ContextEngine> {
	const engine = getContextEngine()

	// Register dispose handler
	context.subscriptions.push({
		dispose: () => {
			engine.shutdown()
		},
	})

	// Initialize engine
	await engine.initialize()

	return engine
}

/**
 * Register Context Engine commands
 */
export function registerContextEngineCommands(context: vscode.ExtensionContext, engine: ContextEngine): void {
	// Re-index project command
	const reindexCommand = vscode.commands.registerCommand("kilocode.contextEngine.reindex", async () => {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Indexing project...",
				cancellable: false,
			},
			async (progress) => {
				await engine.indexProject((prog, message) => {
					progress.report({
						increment: prog,
						message,
					})
				})

				vscode.window.showInformationMessage("Project indexing completed!")
			},
		)
	})

	// Search context command
	const searchCommand = vscode.commands.registerCommand("kilocode.contextEngine.search", async () => {
		const query = await vscode.window.showInputBox({
			prompt: "Enter search query",
			placeHolder: "e.g., How to implement authentication?",
		})

		if (!query) {
			return
		}

		const results = await engine.search({ query, limit: 10 })

		// Show results in QuickPick
		const items = results.map((result) => ({
			label: result.chunk.filePath,
			description: `Score: ${result.score.toFixed(2)}`,
			detail: result.chunk.summary,
			result,
		}))

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: "Select a result to view",
		})

		if (selected) {
			// Open file at specific line
			const uri = vscode.Uri.file(selected.result.chunk.filePath)
			const document = await vscode.workspace.openTextDocument(uri)
			const editor = await vscode.window.showTextDocument(document)
			const line = selected.result.chunk.startLine - 1
			editor.selection = new vscode.Selection(line, 0, line, 0)
			editor.revealRange(new vscode.Range(line, 0, line, 0))
		}
	})

	// Show stats command
	const statsCommand = vscode.commands.registerCommand("kilocode.contextEngine.stats", async () => {
		const stats = engine.getIndexingStats()
		const metrics = await engine.getPerformanceMetrics()

		const message =
			`**Indexing Stats:**\n` +
			`- Total Files: ${stats.totalFiles}\n` +
			`- Indexed Files: ${stats.indexedFiles}\n` +
			`- Total Chunks: ${stats.totalChunks}\n` +
			`- Database Size: ${(stats.databaseSize / 1024 / 1024).toFixed(2)} MB\n\n` +
			`**Performance Metrics:**\n` +
			`- Query Latency (p95): ${metrics.queryLatencyP95.toFixed(2)}ms\n` +
			`- Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%\n` +
			`- Memory Footprint: ${metrics.memoryFootprint.toFixed(2)} MB`

		vscode.window.showInformationMessage(message, { modal: true })
	})

	// Clear index command
	const clearCommand = vscode.commands.registerCommand("kilocode.contextEngine.clear", async () => {
		const confirmed = await vscode.window.showWarningMessage(
			"Are you sure you want to clear the entire context index? This cannot be undone.",
			{ modal: true },
			"Yes, Clear",
			"Cancel",
		)

		if (confirmed === "Yes, Clear") {
			await engine.clear()
			vscode.window.showInformationMessage("Context index cleared successfully!")
		}
	})

	context.subscriptions.push(reindexCommand, searchCommand, statsCommand, clearCommand)

	// Register Settings UI Provider
	const settingsProvider = new ContextEngineSettingsProvider(context.extensionUri, engine)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ContextEngineSettingsProvider.viewType, settingsProvider),
	)

	// Register command to open settings
	const openSettingsCommand = vscode.commands.registerCommand("kilocode.contextEngine.openSettings", () => {
		vscode.commands.executeCommand(`${ContextEngineSettingsProvider.viewType}.focus`)
	})

	context.subscriptions.push(openSettingsCommand)
}

/**
 * Provide context for LLM based on current editor state
 */
export async function provideEditorContext(engine: ContextEngine): Promise<VectorSearchResult[]> {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		return []
	}

	// Get current selection or line
	const selection = editor.selection
	const text = editor.document.getText(selection)

	if (!text) {
		return []
	}

	// Search for related context
	const results = await engine.search({
		query: text,
		limit: 5,
	})

	return results
}

/**
 * Create status bar item for Context Engine
 */
export function createContextEngineStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.text = "$(database) Context Engine"
	statusBar.tooltip = "Click to see Context Engine stats"
	statusBar.command = "kilocode.contextEngine.stats"
	statusBar.show()

	context.subscriptions.push(statusBar)

	return statusBar
}
