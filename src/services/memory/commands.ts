import * as vscode from "vscode"
import { MemoryPressureService } from "./MemoryPressureService"

export function registerMemoryCommands(context: vscode.ExtensionContext): void {
	const memoryService = MemoryPressureService.getInstance()

	const startMonitoringCommand = vscode.commands.registerCommand("kilocode.memory.startMonitoring", () => {
		memoryService.startMonitoring()
		vscode.window.showInformationMessage("Memory monitoring started")
	})

	const stopMonitoringCommand = vscode.commands.registerCommand("kilocode.memory.stopMonitoring", () => {
		memoryService.stopMonitoring()
		vscode.window.showInformationMessage("Memory monitoring stopped")
	})

	const showDetailsCommand = vscode.commands.registerCommand("kilocode.memory.showDetails", () => {
		memoryService.showMemoryDetails()
	})

	const showStatsCommand = vscode.commands.registerCommand("kilocode.memory.showStats", () => {
		const stats = memoryService.getMemoryStatsFormatted()
		vscode.window.showInformationMessage(`Memory Usage: ${stats}`)
	})

	context.subscriptions.push(startMonitoringCommand, stopMonitoringCommand, showDetailsCommand, showStatsCommand)

	context.subscriptions.push({
		dispose: () => {
			memoryService.dispose()
		},
	})
}
