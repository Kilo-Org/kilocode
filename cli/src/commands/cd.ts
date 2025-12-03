import type { Command, ArgumentProviderContext } from "./core/types.js"
import type { CliMessage } from "../types/cli.js"
import { existsSync, statSync } from "fs"
import { resolve } from "path"
import { homedir } from "os"
import { fileSearchService } from "../services/fileSearch.js"

/**
 * Directory autocomplete provider
 * Provides suggestions for directories based on current input
 */
async function directoryAutocompleteProvider(context: ArgumentProviderContext) {
	const { partialInput } = context

	try {
		// Get current working directory from process.cwd()
		const cwd = process.cwd()

		// If partial input is empty, show directories in current location
		const searchQuery = partialInput || ""

		// Get all files and filter for directories only
		const allFiles = await fileSearchService.getAllFiles(cwd)
		const directories = allFiles.filter((file) => file.type === "folder")

		// Filter by search query if provided
		const filteredDirs = searchQuery
			? directories.filter(
					(dir) =>
						dir.basename.toLowerCase().includes(searchQuery.toLowerCase()) ||
						dir.path.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: directories.slice(0, 20) // Limit to 20 if no query

		return filteredDirs.map((dir) => ({
			value: dir.path,
			description: dir.dirname ? `in ${dir.dirname}` : "directory",
			matchScore: searchQuery ? (dir.basename.toLowerCase().includes(searchQuery.toLowerCase()) ? 90 : 70) : 50,
			highlightedValue: dir.path,
		}))
	} catch (error) {
		return [
			{
				value: "",
				description: "Error loading directory suggestions",
				matchScore: 0,
				highlightedValue: "",
				error: error instanceof Error ? error.message : "Unknown error",
			},
		]
	}
}

/**
 * List directories in current location
 */
async function listDirectories(context: { addMessage: (msg: CliMessage) => void }) {
	try {
		const cwd = process.cwd()
		const allFiles = await fileSearchService.getAllFiles(cwd)
		const directories = allFiles.filter((file) => file.type === "folder")

		if (directories.length === 0) {
			context.addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `No subdirectories found in ${cwd}`,
				ts: Date.now(),
			})
			return
		}

		let content = `**Directories in ${cwd}:**\n\n`
		directories.slice(0, 20).forEach((dir) => {
			content += `📁 ${dir.basename}\n`
		})

		if (directories.length > 20) {
			content += `\n... and ${directories.length - 20} more`
		}

		context.addMessage({
			id: Date.now().toString(),
			type: "system",
			content,
			ts: Date.now(),
		})
	} catch (error) {
		context.addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to list directories: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

export const cdCommand: Command = {
	name: "cd",
	aliases: ["change-dir", "cd"],
	description: "Change directory or list directories",
	usage: "/cd [directory]",
	examples: ["/cd ./src", "/cd ../", "/cd /home/user/projects", "/cd ~", "/cd (lists directories)"],
	category: "navigation",
	priority: 1,
	arguments: [
		{
			name: "directory",
			description: "Directory path to change to (leave empty to list directories)",
			required: false,
			provider: directoryAutocompleteProvider,
			placeholder: "Enter directory path or leave empty to list",
		},
	],
	handler: async (context) => {
		const { args, addMessage } = context

		// If no arguments provided, list directories in current location
		if (args.length === 0) {
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `Current directory: ${process.cwd()}\n\nUse /cd <directory> to change directory, or /cd without arguments to list directories.`,
				ts: Date.now(),
			})
			await listDirectories(context)
			return
		}

		let targetPath = args[0]
		const userHomeDir = homedir()
		// Handle special cases
		if (targetPath === "~") {
			targetPath = userHomeDir
		} else if (targetPath === "-") {
			// TODO: Implement cd - (previous directory) if we track it
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: "cd - (previous directory) not yet implemented",
				ts: Date.now(),
			})
			return
		} else if (targetPath && targetPath.startsWith("~/")) {
			targetPath = resolve(userHomeDir, targetPath.slice(2))
		}

		// Resolve relative paths
		if (targetPath) {
			targetPath = resolve(process.cwd(), targetPath)
		}

		// Check if targetPath is defined
		if (!targetPath) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: "Invalid target path",
				ts: Date.now(),
			})
			return
		}

		// Check if path exists
		if (!existsSync(targetPath)) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Directory does not exist: ${targetPath}`,
				ts: Date.now(),
			})
			return
		}

		// Check if it's actually a directory
		try {
			const stats = statSync(targetPath)
			if (!stats.isDirectory()) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Not a directory: ${targetPath}`,
					ts: Date.now(),
				})
				return
			}
		} catch (_error) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Cannot access path: ${targetPath}`,
				ts: Date.now(),
			})
			return
		}

		try {
			process.chdir(targetPath)
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `Changed directory to: ${targetPath}`,
				ts: Date.now(),
			})
		} catch (error) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Failed to change directory: ${error instanceof Error ? error.message : String(error)}`,
				ts: Date.now(),
			})
		}
	},
}
