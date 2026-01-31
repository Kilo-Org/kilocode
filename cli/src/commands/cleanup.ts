import { rm, stat } from "fs/promises"
import path from "path"
import { confirm } from "@inquirer/prompts"
import { KiloCodePaths } from "@kilocode/agent-runtime"
import { getHistoryPath } from "../config/history.js"
import { getConfigPath } from "../config/persistence.js"
import { logs } from "../services/logs.js"

type CleanupKey = "logs" | "tasks" | "history" | "config" | "identity"

export interface CleanupOptions {
	all?: boolean
	logs?: boolean
	tasks?: boolean
	history?: boolean
	config?: boolean
	identity?: boolean
	dryRun?: boolean
	yes?: boolean
}

export interface CleanupPaths {
	logsDir: string
	tasksDir: string
	historyFile: string
	configFile: string
	identityFile: string
}

interface CleanupTarget {
	key: CleanupKey
	label: string
	path: string
	kind: "file" | "dir"
}

interface CleanupTargetStatus extends CleanupTarget {
	exists: boolean
}

interface CleanupIo {
	log: (message: string) => void
	error: (message: string) => void
}

export interface CleanupResult {
	exitCode: number
	planned: CleanupTargetStatus[]
	removed: CleanupTargetStatus[]
	skipped: CleanupTargetStatus[]
	errors: Array<{ target: CleanupTargetStatus; message: string }>
	dryRun: boolean
	cancelled: boolean
}

interface CleanupDependencies {
	paths?: CleanupPaths
	io?: CleanupIo
	confirm?: (message: string) => Promise<boolean>
	isInteractive?: boolean
}

export function getCleanupPaths(): CleanupPaths {
	return {
		logsDir: KiloCodePaths.getLogsDir(),
		tasksDir: KiloCodePaths.getTasksDir(),
		historyFile: getHistoryPath(),
		configFile: getConfigPath(),
		identityFile: path.join(KiloCodePaths.getKiloCodeDir(), "identity.json"),
	}
}

function resolveSelection(options: CleanupOptions): Set<CleanupKey> {
	const selection = new Set<CleanupKey>()

	const flags = {
		logs: options.logs === true,
		tasks: options.tasks === true,
		history: options.history === true,
		config: options.config === true,
		identity: options.identity === true,
	}

	const anyExplicit = Object.values(flags).some(Boolean)

	if (options.all) {
		Object.keys(flags).forEach((key) => {
			selection.add(key as CleanupKey)
		})
		return selection
	}

	if (!anyExplicit) {
		selection.add("logs")
		selection.add("tasks")
		selection.add("history")
		return selection
	}

	if (flags.logs) selection.add("logs")
	if (flags.tasks) selection.add("tasks")
	if (flags.history) selection.add("history")
	if (flags.config) selection.add("config")
	if (flags.identity) selection.add("identity")

	return selection
}

function buildTargets(paths: CleanupPaths): CleanupTarget[] {
	return [
		{ key: "logs", label: "Logs", path: paths.logsDir, kind: "dir" },
		{ key: "tasks", label: "Tasks", path: paths.tasksDir, kind: "dir" },
		{ key: "history", label: "Command history", path: paths.historyFile, kind: "file" },
		{ key: "config", label: "Config", path: paths.configFile, kind: "file" },
		{ key: "identity", label: "Identity", path: paths.identityFile, kind: "file" },
	]
}

async function checkTarget(target: CleanupTarget): Promise<CleanupTargetStatus> {
	try {
		await stat(target.path)
		return { ...target, exists: true }
	} catch {
		return { ...target, exists: false }
	}
}

function formatTarget(target: CleanupTargetStatus): string {
	const suffix = target.exists ? "" : " (not found)"
	return `- ${target.label}: ${target.path}${suffix}`
}

function getConfirmMessage(targets: CleanupTargetStatus[]): string {
	const labelList = targets.map((target) => target.label).join(", ")
	return `Delete ${targets.length} item${targets.length === 1 ? "" : "s"} (${labelList})?`
}

export async function runCleanup(options: CleanupOptions, deps: CleanupDependencies = {}): Promise<CleanupResult> {
	const io = deps.io ?? console
	const paths = deps.paths ?? getCleanupPaths()
	const selection = resolveSelection(options)

	if (selection.size === 0) {
		io.error("Error: No cleanup targets selected. Use --logs, --tasks, --history, --config, --identity, or --all.")
		return {
			exitCode: 1,
			planned: [],
			removed: [],
			skipped: [],
			errors: [],
			dryRun: Boolean(options.dryRun),
			cancelled: false,
		}
	}

	const targets = buildTargets(paths).filter((target) => selection.has(target.key))
	const planned = await Promise.all(targets.map((target) => checkTarget(target)))

	io.log("Cleanup targets:")
	planned.forEach((target) => io.log(formatTarget(target)))

	if (options.dryRun) {
		io.log("Dry run: no files were deleted.")
		return {
			exitCode: 0,
			planned,
			removed: [],
			skipped: planned.filter((target) => !target.exists),
			errors: [],
			dryRun: true,
			cancelled: false,
		}
	}

	if (!options.yes) {
		const isInteractive = deps.isInteractive ?? process.stdin.isTTY
		if (!isInteractive) {
			io.error("Error: Non-interactive mode requires --yes or --dry-run.")
			return {
				exitCode: 1,
				planned,
				removed: [],
				skipped: [],
				errors: [],
				dryRun: false,
				cancelled: false,
			}
		}

		const confirmFn = deps.confirm ?? (async (message: string) => confirm({ message, default: false }))
		const confirmed = await confirmFn(getConfirmMessage(planned))
		if (!confirmed) {
			io.log("Cleanup cancelled.")
			return {
				exitCode: 0,
				planned,
				removed: [],
				skipped: [],
				errors: [],
				dryRun: false,
				cancelled: true,
			}
		}
	}

	logs.info("Running cleanup command", "Cleanup", { targets: planned.map((target) => target.key) })

	const removed: CleanupTargetStatus[] = []
	const skipped: CleanupTargetStatus[] = []
	const errors: Array<{ target: CleanupTargetStatus; message: string }> = []

	for (const target of planned) {
		if (!target.exists) {
			skipped.push(target)
			continue
		}

		try {
			await rm(target.path, { recursive: true, force: true })
			removed.push(target)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			errors.push({ target, message })
			io.error(`Failed to delete ${target.label.toLowerCase()}: ${message}`)
		}
	}

	if (removed.length > 0) {
		io.log(`Removed ${removed.length} item${removed.length === 1 ? "" : "s"}.`)
	}

	if (skipped.length > 0) {
		io.log(`Skipped ${skipped.length} item${skipped.length === 1 ? "" : "s"} (not found).`)
	}

	if (errors.length > 0) {
		io.error(`Cleanup finished with ${errors.length} error${errors.length === 1 ? "" : "s"}.`)
	}

	return {
		exitCode: errors.length > 0 ? 1 : 0,
		planned,
		removed,
		skipped,
		errors,
		dryRun: false,
		cancelled: false,
	}
}

export async function cleanupCommand(options: CleanupOptions): Promise<void> {
	const result = await runCleanup(options)
	process.exit(result.exitCode)
}
