import { Anthropic } from "@anthropic-ai/sdk"
import os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { HistoryItem } from "../../shared/HistoryItem" // kilocode_change

export async function downloadTask(dateTs: number, conversationHistory: Anthropic.MessageParam[]) {
	// File name
	const date = new Date(dateTs)
	const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase()
	const day = date.getDate()
	const year = date.getFullYear()
	let hours = date.getHours()
	const minutes = date.getMinutes().toString().padStart(2, "0")
	const seconds = date.getSeconds().toString().padStart(2, "0")
	const ampm = hours >= 12 ? "pm" : "am"
	hours = hours % 12
	hours = hours ? hours : 12 // the hour '0' should be '12'
	const fileName = `kilo_code_task_${month}-${day}-${year}_${hours}-${minutes}-${seconds}-${ampm}.md` // kilocode_change

	// Generate markdown
	const markdownContent = conversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")

	// Prompt user for save location
	const saveUri = await vscode.window.showSaveDialog({
		filters: { Markdown: ["md"] },
		defaultUri: vscode.Uri.file(path.join(os.homedir(), "Downloads", fileName)),
	})

	if (saveUri) {
		// Write content to the selected location
		await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdownContent))
		vscode.window.showTextDocument(saveUri, { preview: true })
	}
}

// kilocode_change
export async function downloadTaskFamily(
	taskFamily: TaskFamilyData,
	getTaskWithId: (id: string) => Promise<{
		historyItem: HistoryItem
		apiConversationHistory: Anthropic.MessageParam[]
	}>,
) {
	const folderName = generateTaskFamilyFolderName(taskFamily)

	// Prompt user for folder location
	const selectedFolders = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: "Select Export Location",
		defaultUri: vscode.Uri.file(os.homedir()),
	})

	if (!selectedFolders || selectedFolders.length === 0) {
		return
	}

	try {
		// Create the task family folder inside the selected location
		const folderUri = vscode.Uri.joinPath(selectedFolders[0], folderName)

		// Create the main folder
		await vscode.workspace.fs.createDirectory(folderUri)

		// Generate and write individual task files
		for (const task of taskFamily.tasks) {
			const { apiConversationHistory } = await getTaskWithId(task.id)
			const taskFileName = generateTaskFileName(task)
			const taskFileUri = vscode.Uri.joinPath(folderUri, taskFileName)

			const markdownContent = generateTaskMarkdown(apiConversationHistory, task)
			await vscode.workspace.fs.writeFile(taskFileUri, Buffer.from(markdownContent))
		}

		// Generate and write index file
		const indexContent = generateFamilyIndexMarkdown(taskFamily)
		const indexUri = vscode.Uri.joinPath(folderUri, "README.md")
		await vscode.workspace.fs.writeFile(indexUri, Buffer.from(indexContent))

		// Show success message and open the folder
		await vscode.window.showInformationMessage(`Task family exported to: ${folderUri.fsPath}`)
		await vscode.commands.executeCommand("vscode.openFolder", folderUri, { forceNewWindow: true })
	} catch (error) {
		await vscode.window.showErrorMessage(`Failed to export task family: ${error}`)
	}
}

export interface TaskFamilyData {
	rootTask: HistoryItem
	tasks: HistoryItem[]
	hierarchy: TaskHierarchyNode[]
}

export interface TaskHierarchyNode {
	task: HistoryItem
	children: TaskHierarchyNode[]
}

export function buildTaskFamily(allTasks: HistoryItem[], rootTaskId: string): TaskFamilyData {
	// Find all tasks in the family
	const familyTasks = allTasks.filter((task) => task.rootTaskId === rootTaskId || task.id === rootTaskId)

	// Find the root task
	const rootTask = familyTasks.find((task) => task.id === rootTaskId)
	if (!rootTask) {
		throw new Error(`Root task ${rootTaskId} not found`)
	}

	// Build hierarchy - start with undefined to find root tasks (tasks with no parent)
	const hierarchy = buildTaskHierarchy(familyTasks, undefined)

	// Sort tasks chronologically
	const sortedTasks = familyTasks.sort((a, b) => a.ts - b.ts)

	return {
		rootTask,
		tasks: sortedTasks,
		hierarchy,
	}
}

function buildTaskHierarchy(tasks: HistoryItem[], parentId?: string): TaskHierarchyNode[] {
	const children = tasks.filter((task) => task.parentTaskId === parentId)

	return children.map((task) => ({
		task,
		children: buildTaskHierarchy(tasks, task.id),
	}))
}

function generateTaskFamilyFolderName(taskFamily: TaskFamilyData): string {
	const firstMode = taskFamily.rootTask.mode || taskFamily.tasks.find((t) => t.mode)?.mode || "unknown"

	const latestTimestamp = Math.max(...taskFamily.tasks.map((t) => t.ts))
	const date = new Date(latestTimestamp)

	const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase()
	const day = date.getDate()
	const year = date.getFullYear()
	let hours = date.getHours()
	const minutes = date.getMinutes().toString().padStart(2, "0")
	const seconds = date.getSeconds().toString().padStart(2, "0")
	const ampm = hours >= 12 ? "pm" : "am"
	hours = hours % 12
	hours = hours ? hours : 12

	return `kilo_code_${firstMode}_task_${month}-${day}-${year}_${hours}-${minutes}-${seconds}-${ampm}`
}

function generateTaskFileName(task: HistoryItem): string {
	const date = new Date(task.ts)
	const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase()
	const day = date.getDate()
	const year = date.getFullYear()
	let hours = date.getHours()
	const minutes = date.getMinutes().toString().padStart(2, "0")
	const seconds = date.getSeconds().toString().padStart(2, "0")
	const ampm = hours >= 12 ? "pm" : "am"
	hours = hours % 12
	hours = hours ? hours : 12

	const mode = task.mode || "unknown"
	const taskNumber = task.number.toString().padStart(3, "0")

	return `task_${taskNumber}_${mode}_${month}-${day}-${year}_${hours}-${minutes}-${seconds}-${ampm}.md`
}

function generateTaskMarkdown(conversationHistory: Anthropic.MessageParam[], task: HistoryItem): string {
	const header = `# Task ${task.number}: ${task.task}\n\n`
	const metadata =
		`**Mode:** ${task.mode || "unknown"}  \n` +
		`**Created:** ${new Date(task.ts).toLocaleString()}  \n` +
		`**Task ID:** ${task.id}  \n` +
		(task.parentTaskId ? `**Parent Task ID:** ${task.parentTaskId}  \n` : "") +
		(task.rootTaskId ? `**Root Task ID:** ${task.rootTaskId}  \n` : "") +
		`**Tokens In:** ${task.tokensIn}  \n` +
		`**Tokens Out:** ${task.tokensOut}  \n` +
		`**Total Cost:** $${task.totalCost.toFixed(4)}  \n\n`

	const content = conversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")

	return header + metadata + "## Conversation\n\n" + content
}

function generateFamilyIndexMarkdown(taskFamily: TaskFamilyData): string {
	const header = `# Task Family: ${taskFamily.rootTask.task}\n\n`

	const summary =
		`## Summary\n\n` +
		`**Root Task:** ${taskFamily.rootTask.task}  \n` +
		`**Total Tasks:** ${taskFamily.tasks.length}  \n` +
		`**First Mode:** ${taskFamily.rootTask.mode || "unknown"}  \n` +
		`**Created:** ${new Date(taskFamily.rootTask.ts).toLocaleString()}  \n` +
		`**Last Updated:** ${new Date(Math.max(...taskFamily.tasks.map((t) => t.ts))).toLocaleString()}  \n\n`

	const hierarchy = `## Task Hierarchy\n\n` + renderTaskHierarchy(taskFamily.hierarchy, 0) + "\n"

	const chronology =
		`## Chronological Order\n\n` +
		taskFamily.tasks
			.map((task, index) => {
				const fileName = generateTaskFileName(task)
				return `${index + 1}. [Task ${task.number}: ${task.task}](./${fileName}) (${task.mode || "unknown"}) - ${new Date(task.ts).toLocaleString()}`
			})
			.join("\n") +
		"\n\n"

	const metrics =
		`## Metrics\n\n` +
		`**Total Tokens In:** ${taskFamily.tasks.reduce((sum, t) => sum + t.tokensIn, 0)}  \n` +
		`**Total Tokens Out:** ${taskFamily.tasks.reduce((sum, t) => sum + t.tokensOut, 0)}  \n` +
		`**Total Cost:** $${taskFamily.tasks.reduce((sum, t) => sum + t.totalCost, 0).toFixed(4)}  \n\n`

	return header + summary + hierarchy + chronology + metrics
}

function renderTaskHierarchy(nodes: TaskHierarchyNode[], depth: number): string {
	return nodes
		.map((node) => {
			const indent = "  ".repeat(depth)
			const fileName = generateTaskFileName(node.task)
			const line = `${indent}- [Task ${node.task.number}: ${node.task.task}](./${fileName}) (${node.task.mode || "unknown"})`

			if (node.children.length > 0) {
				return line + "\n" + renderTaskHierarchy(node.children, depth + 1)
			}
			return line
		})
		.join("\n")
}
// kilocode_change end

export function formatContentBlockToMarkdown(block: Anthropic.Messages.ContentBlockParam): string {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return `[Image]`
		case "tool_use": {
			let input: string
			if (typeof block.input === "object" && block.input !== null) {
				input = Object.entries(block.input)
					.map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`)
					.join("\n")
			} else {
				input = String(block.input)
			}
			return `[Tool Use: ${block.name}]\n${input}`
		}
		case "tool_result": {
			// For now we're not doing tool name lookup since we don't use tools anymore
			// const toolName = findToolName(block.tool_use_id, messages)
			const toolName = "Tool"
			if (typeof block.content === "string") {
				return `[${toolName}${block.is_error ? " (Error)" : ""}]\n${block.content}`
			} else if (Array.isArray(block.content)) {
				return `[${toolName}${block.is_error ? " (Error)" : ""}]\n${block.content
					.map((contentBlock) => formatContentBlockToMarkdown(contentBlock))
					.join("\n")}`
			} else {
				return `[${toolName}${block.is_error ? " (Error)" : ""}]`
			}
		}
		default:
			return "[Unexpected content type]"
	}
}

export function findToolName(toolCallId: string, messages: Anthropic.MessageParam[]): string {
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "tool_use" && block.id === toolCallId) {
					return block.name
				}
			}
		}
	}
	return "Unknown Tool"
}
