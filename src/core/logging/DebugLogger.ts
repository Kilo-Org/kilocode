import * as vscode from "vscode"

const isCliMode = process.env.KILO_CLI === "true"
let outputChannel: vscode.OutputChannel | null = null

function getOutputChannel(): vscode.OutputChannel | null {
	if (isCliMode) return null

	if (!outputChannel) {
		try {
			if (typeof vscode !== "undefined" && vscode.window?.createOutputChannel) {
				outputChannel = vscode.window.createOutputChannel("Kilo Code Debug")
			}
		} catch {
			// VS Code API not available
		}
	}
	return outputChannel
}

function formatDetails(details: any): string {
	if (typeof details === "string") return details
	if (typeof details === "object" && details !== null) {
		try {
			return JSON.stringify(details, null, 2)
		} catch {
			return String(details)
		}
	}
	return String(details)
}

function log(context: string, operation: string, details?: any): void {
	const timestamp = new Date().toISOString()
	const message = `🚀 [${context}] ${operation}${details ? `: ${formatDetails(details)}` : ""}`
	const fullMessage = `[${timestamp}] ${message}`

	const channel = getOutputChannel()
	if (isCliMode || !channel) {
		console.log(fullMessage)
	} else {
		channel.appendLine(fullMessage)
	}
}

export function logConfig(operation: string, configKey: string, value?: any): void {
	// Disabled for production - uncomment for debugging
	// log("CONFIG", `${operation} - ${configKey}`, value !== undefined ? { value } : undefined)
}

export function logPermission(operation: string, resource: string, result?: boolean): void {
	// Disabled for production - uncomment for debugging
	// log("PERMISSION", `${operation} - ${resource}`, result !== undefined ? { allowed: result } : undefined)
}

export function logTask(taskId: string, operation: string, details?: any): void {
	// Disabled for production - uncomment for debugging
	// log("TASK", `${taskId} - ${operation}`, details)
}

export function logTool(toolName: string, operation: string, details?: any): void {
	// Disabled for production - uncomment for debugging
	// log("TOOL", `${toolName} - ${operation}`, details)
}

export function logVSCodeAPI(apiCall: string, details?: any): void {
	// Disabled for production - uncomment for debugging
	// log("VSCODE-API", apiCall, details)
}

export function logDecision(context: string, decision: string, reasoning?: string): void {
	// Disabled for production - uncomment for debugging
	// log("DECISION", `${context} - ${decision}`, reasoning ? { reasoning } : undefined)
}
