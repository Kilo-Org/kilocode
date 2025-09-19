import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"

import { GlobalFileNames } from "../shared/globalFileNames"
import { HistoryItem } from "@roo-code/types"

export class HistoryService {
	private static instance: HistoryService
	private history: HistoryItem[] = []
	private context: vscode.ExtensionContext
	private isLoading: boolean = false

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.loadHistory().catch((error) => console.error("Failed to load task history:", error))
	}

	public static getInstance(context: vscode.ExtensionContext): HistoryService {
		if (!HistoryService.instance) {
			HistoryService.instance = new HistoryService(context)
		}
		return HistoryService.instance
	}

	private async getHistoryFilePath(): Promise<string> {
		const storagePath = this.context.globalStorageUri.fsPath
		await fs.mkdir(storagePath, { recursive: true })
		return path.join(storagePath, GlobalFileNames.taskHistory)
	}

	private async loadHistory(): Promise<void> {
		if (this.isLoading) {
			return
		}

		this.isLoading = true
		try {
			const historyPath = await this.getHistoryFilePath()
			const data = await fs.readFile(historyPath, "utf8")
			this.history = JSON.parse(data)
		} catch (error) {
			if (error.code === "ENOENT") {
				// File doesn't exist, try to migrate from globalState
				const oldHistory = this.context.globalState.get<HistoryItem[]>("taskHistory")
				if (oldHistory && Array.isArray(oldHistory) && oldHistory.length > 0) {
					console.log("Migrating chat history from globalState to file storage.")
					this.history = oldHistory
					await this.writeHistory()
					// Clear the old history from globalState
					await this.context.globalState.update("taskHistory", undefined)
				} else {
					this.history = []
				}
			} else {
				console.error("Failed to load task history:", error)
				this.history = []
			}
		} finally {
			this.isLoading = false
		}
	}

	public async getHistory(): Promise<HistoryItem[]> {
		if (this.isLoading) {
			// Wait for the loading to complete before returning the history
			await pWaitFor(() => !this.isLoading, { timeout: 5000 })
		} else if (this.history.length === 0) {
			// If history is empty, try reloading it
			await this.loadHistory()
		}
		return [...this.history] // Return a copy to prevent direct modification
	}

	public async setHistory(history: HistoryItem[]): Promise<void> {
		this.history = [...history] // Store a copy
		await this.writeHistory()
	}

	public getRecentTasks(workspace: string): string[] {
		const workspaceTasks = this.history.filter((item) => item.workspace === workspace)
		workspaceTasks.sort((a, b) => b.ts - a.ts)
		return workspaceTasks.map((item) => item.id)
	}

	public async updateTaskHistory(item: HistoryItem): Promise<void> {
		const existingItemIndex = this.history.findIndex((h) => h.id === item.id)
		if (existingItemIndex !== -1) {
			this.history[existingItemIndex] = item
		} else {
			this.history.push(item)
		}
		await this.writeHistory()
	}

	public async deleteTask(id: string): Promise<void> {
		this.history = this.history.filter((item) => item.id !== id)
		await this.writeHistory()
	}

	private async writeHistory(): Promise<void> {
		try {
			const historyPath = await this.getHistoryFilePath()
			await fs.writeFile(historyPath, JSON.stringify(this.history, null, 2))
		} catch (error) {
			console.error("Failed to write task history:", error)
		}
	}
}

// Export the legacy functions for backward compatibility
export async function readTaskHistory(context: vscode.ExtensionContext): Promise<HistoryItem[]> {
	const service = HistoryService.getInstance(context)
	return await service.getHistory()
}

export async function writeTaskHistory(context: vscode.ExtensionContext, history: HistoryItem[]): Promise<void> {
	const service = HistoryService.getInstance(context)
	await service.setHistory(history)
}
