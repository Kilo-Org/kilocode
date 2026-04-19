import * as vscode from "vscode"
import { randomUUID } from "crypto"
import { KiloLogger } from "../KiloLogger"

// ─── Types ───────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high"
export type NetworkPolicy = "deny" | "allowlist" | "open"
export type WritePolicy = "read_only" | "buffered" | "approved"
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "blocked"

export interface TaskLimits {
	timeoutSec: number
	memoryMb: number
	cpu: number
}

export interface ZeroClawTask {
	taskId: string
	description: string
	projectPath: string
	riskLevel: RiskLevel
	workspaceScope: string[]
	networkPolicy: NetworkPolicy
	writePolicy: WritePolicy
	limits: TaskLimits
	status: TaskStatus
	exitCode?: number
	logs: string[]
	changedFiles: string[]
	artifacts: string[]
	requiresApproval: boolean
	approvedBy?: string
	createdAt: number
	completedAt?: number
	retryCount: number
}

export interface TaskSubmission {
	description: string
	projectPath: string
	riskLevel: RiskLevel
	workspaceScope: string
	networkPolicy: NetworkPolicy
	writePolicy: WritePolicy
	limits: TaskLimits
}

export interface TaskStatusEvent {
	taskId: string
	status: TaskStatus
	task: ZeroClawTask
}

export interface Artifact {
	name: string
	path: string
	type: "file" | "diff" | "log" | "screenshot"
	sizeBytes: number
	createdAt: number
}

export interface TaskResult {
	taskId: string
	status: string
	artifacts: Artifact[]
	logs: string[]
	summary: string
	duration: number
	exitCode?: number
}

type StatusListener = (event: TaskStatusEvent) => void

const HISTORY_STATE_KEY = "zeroclaw.executionHistory"
const MAX_HISTORY = 200

// ─── Service ─────────────────────────────────────────────

/**
 * Manages ZeroClaw task queue and execution.
 *
 * Evaluates risk level to determine execution path:
 * - Low risk: auto-execute in VS Code terminal
 * - Medium risk: execute but buffer changes, require diff review
 * - High risk: block until approved
 *
 * Tracks execution history in workspace state and emits events
 * for status changes so the webview can stay in sync.
 */
export class ZeroClawService implements vscode.Disposable {
	private readonly log = KiloLogger.for("ZeroClawService")
	private readonly tasks = new Map<string, ZeroClawTask>()
	private readonly queue: string[] = []
	private readonly listeners = new Set<StatusListener>()
	private readonly disposables: vscode.Disposable[] = []
	private readonly terminals = new Map<string, vscode.Terminal>()
	private readonly executionTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private readonly maxRetries: number = 3
	private processing = false

	constructor(private readonly ctx: vscode.ExtensionContext) {
		// Restore persisted history into the in-memory map
		const saved = ctx.workspaceState.get<ZeroClawTask[]>(HISTORY_STATE_KEY, [])
		for (const task of saved) {
			this.tasks.set(task.taskId, task)
		}

		// Clean up terminals that are closed externally
		const termClose = vscode.window.onDidCloseTerminal((t) => {
			for (const [taskId, term] of this.terminals) {
				if (term === t) {
					this.terminals.delete(taskId)
					this.clearExecutionTimer(taskId)
					const task = this.tasks.get(taskId)
					if (task && task.status === "running") {
						this.rollbackTask(taskId)
						this.transitionStatus(taskId, "failed")
						this.appendLog(taskId, "[ZeroClaw] Terminal closed externally")
					}
					break
				}
			}
		})
		this.disposables.push(termClose)

		this.log.info("ZeroClawService initialized")
	}

	// ─── Public API ────────────────────────────────────────

	/** Submit a new task. Returns the created task, or throws if validation fails. */
	submit(submission: TaskSubmission): ZeroClawTask {
		const endTimer = this.log.time("submitTask")

		if (!this.validateRiskLevel(submission)) {
			throw new Error("Invalid task submission: failed risk validation")
		}

		const taskId = randomUUID().slice(0, 12)
		const scopeParts = submission.workspaceScope
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)

		this.log.info("Task submitted", { taskId, description: submission.description })

		const task: ZeroClawTask = {
			taskId,
			description: submission.description,
			projectPath: submission.projectPath,
			riskLevel: submission.riskLevel,
			workspaceScope: scopeParts,
			networkPolicy: submission.networkPolicy,
			writePolicy: submission.writePolicy,
			limits: { ...submission.limits },
			status: "queued",
			logs: [],
			changedFiles: [],
			artifacts: [],
			requiresApproval: submission.riskLevel === "high",
			createdAt: Date.now(),
			retryCount: 0,
		}

		this.tasks.set(taskId, task)
		this.appendLog(taskId, `[ZeroClaw] Task ${taskId} created (risk: ${task.riskLevel})`)

		if (task.riskLevel === "high") {
			this.transitionStatus(taskId, "blocked")
			this.appendLog(taskId, "[ZeroClaw] High-risk task blocked pending approval")
		} else {
			this.queue.push(taskId)
			this.processQueue()
		}

		this.persistHistory()
		endTimer()
		return task
	}

	/** Cancel a running or queued task. */
	cancel(taskId: string): boolean {
		const task = this.tasks.get(taskId)
		if (!task) return false

		if (task.status === "queued") {
			const idx = this.queue.indexOf(taskId)
			if (idx >= 0) this.queue.splice(idx, 1)
			this.transitionStatus(taskId, "failed")
			this.appendLog(taskId, "[ZeroClaw] Task cancelled while queued")
			this.persistHistory()
			return true
		}

		if (task.status === "running") {
			const terminal = this.terminals.get(taskId)
			if (terminal) {
				terminal.dispose()
				this.terminals.delete(taskId)
			}
			this.transitionStatus(taskId, "failed")
			this.appendLog(taskId, "[ZeroClaw] Task cancelled while running")
			this.persistHistory()
			return true
		}

		if (task.status === "blocked") {
			this.transitionStatus(taskId, "failed")
			this.appendLog(taskId, "[ZeroClaw] Blocked task cancelled")
			this.persistHistory()
			return true
		}

		return false
	}

	/** Retry a failed task by resubmitting it to the queue. Respects retry budget. */
	retry(taskId: string): ZeroClawTask | undefined {
		const original = this.tasks.get(taskId)
		if (!original || original.status !== "failed") return undefined

		if (original.retryCount >= this.maxRetries) {
			this.appendLog(taskId, `[ZeroClaw] Retry budget exhausted (${original.retryCount}/${this.maxRetries})`)
			this.persistHistory()
			return undefined
		}

		original.retryCount++
		this.appendLog(taskId, `[ZeroClaw] Retry ${original.retryCount}/${this.maxRetries}`)
		this.persistHistory()

		const newTask = this.submit({
			description: original.description,
			projectPath: original.projectPath,
			riskLevel: original.riskLevel,
			workspaceScope: original.workspaceScope.join(", "),
			networkPolicy: original.networkPolicy,
			writePolicy: original.writePolicy,
			limits: { ...original.limits },
		})

		// Carry over the retry count to the new task
		newTask.retryCount = original.retryCount
		this.persistHistory()
		return newTask
	}

	/** Approve a high-risk (blocked) task. Moves it into the queue. */
	approve(taskId: string, approver: string): boolean {
		const task = this.tasks.get(taskId)
		if (!task || task.status !== "blocked") return false

		task.approvedBy = approver
		task.requiresApproval = false
		this.appendLog(taskId, `[ZeroClaw] Approved by ${approver}`)
		this.queue.push(taskId)
		this.transitionStatus(taskId, "queued")
		this.persistHistory()
		this.processQueue()
		return true
	}

	/** Reject a blocked task. Moves it to failed. */
	reject(taskId: string, reason?: string): boolean {
		const task = this.tasks.get(taskId)
		if (!task || task.status !== "blocked") return false

		this.appendLog(taskId, `[ZeroClaw] Rejected${reason ? `: ${reason}` : ""}`)
		this.transitionStatus(taskId, "failed")
		this.persistHistory()
		return true
	}

	/** Get a single task by ID. */
	getTask(taskId: string): ZeroClawTask | undefined {
		this.log.debug("getTask requested", { taskId })
		return this.tasks.get(taskId)
	}

	/** Get all tasks, ordered newest first. */
	getAllTasks(): ZeroClawTask[] {
		this.log.debug("getAllTasks requested", { count: this.tasks.size })
		return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
	}

	/** Get the last N tasks for history display. */
	getHistory(limit = 50): ZeroClawTask[] {
		return this.getAllTasks().slice(0, limit)
	}

	/**
	 * Build a safe default task context for pre-populating the ZeroClaw tab's
	 * submission form. Values are derived from the active workspace folder.
	 */
	getDefaultTaskContext(): {
		projectPath: string
		workspaceScope: string
		riskLevel: "low"
		networkPolicy: "none"
		writePolicy: "workspace-only"
		limits: { maxSeconds: number; maxFilesChanged: number }
		templates: Array<{ name: string; description: string; command: string }>
	} {
		let workspaceFsPath = ""
		try {
			workspaceFsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
		} catch (err: unknown) {
			this.log.warn("getDefaultTaskContext: failed to resolve workspace", err)
			workspaceFsPath = ""
		}

		return {
			projectPath: workspaceFsPath,
			workspaceScope: workspaceFsPath,
			riskLevel: "low" as const,
			networkPolicy: "none" as const,
			writePolicy: "workspace-only" as const,
			limits: { maxSeconds: 300, maxFilesChanged: 20 },
			templates: [
				{ name: "Format project", description: "Run formatter across all files", command: "" },
				{ name: "Run tests", description: "Run test suite", command: "npm test" },
				{ name: "Type check", description: "Run TypeScript typecheck", command: "tsc --noEmit" },
			],
		}
	}

	// ─── Result & Artifact API ─────────────────────────────

	/**
	 * Build a full TaskResult snapshot for a given task.
	 * Returns undefined if the task does not exist.
	 */
	getTaskResult(taskId: string): TaskResult | undefined {
		this.log.debug("getTaskResult requested", { taskId })
		const task = this.tasks.get(taskId)
		if (!task) return undefined

		const duration =
			task.completedAt && task.createdAt
				? task.completedAt - task.createdAt
				: 0

		return {
			taskId: task.taskId,
			status: task.status,
			artifacts: this.buildArtifactsFromTask(task),
			logs: [...task.logs],
			summary: this.formatTaskSummary(taskId),
			duration,
			exitCode: task.exitCode,
		}
	}

	/**
	 * Scan a task's workspace and artifact paths to collect structured Artifact records.
	 * Inspects the task's changedFiles and artifacts lists, then stats each path
	 * on disk to gather size and creation time.
	 */
	async collectArtifacts(taskId: string): Promise<Artifact[]> {
		const task = this.tasks.get(taskId)
		if (!task) return []

		const fs = await import("fs/promises")
		const path = await import("path")
		const collected: Artifact[] = []

		// Combine both changedFiles and artifacts into candidates
		const candidates = [...new Set([...task.changedFiles, ...task.artifacts])]

		for (const filePath of candidates) {
			try {
				const stat = await fs.stat(filePath)
				const ext = path.extname(filePath).toLowerCase()
				const artifactType = this.classifyArtifact(ext, filePath)

				collected.push({
					name: path.basename(filePath),
					path: filePath,
					type: artifactType,
					sizeBytes: stat.size,
					createdAt: stat.birthtimeMs || stat.mtimeMs,
				})
			} catch {
				// File may have been cleaned up or is unreachable; skip it
			}
		}

		// Update the task's artifact list with any newly discovered paths
		const existingSet = new Set(task.artifacts)
		for (const a of collected) {
			if (!existingSet.has(a.path)) {
				task.artifacts.push(a.path)
			}
		}

		if (collected.length > 0) {
			this.appendLog(taskId, `[ZeroClaw] Collected ${collected.length} artifact(s)`)
			this.persistHistory()
		}

		return collected
	}

	/**
	 * Build a human-readable summary of a task's execution.
	 * Suitable for display in the webview or notification messages.
	 */
	formatTaskSummary(taskId: string): string {
		const task = this.tasks.get(taskId)
		if (!task) return `Task ${taskId}: not found`

		const lines: string[] = []

		// Header
		const statusLabel = task.status.toUpperCase()
		lines.push(`Task ${task.taskId} [${statusLabel}]`)

		// Description (truncated)
		const descPreview =
			task.description.length > 80
				? task.description.slice(0, 77) + "..."
				: task.description
		lines.push(`  Description: ${descPreview}`)

		// Risk + policies
		lines.push(`  Risk: ${task.riskLevel} | Network: ${task.networkPolicy} | Write: ${task.writePolicy}`)

		// Duration
		if (task.completedAt && task.createdAt) {
			const durSec = ((task.completedAt - task.createdAt) / 1000).toFixed(1)
			lines.push(`  Duration: ${durSec}s`)
		} else if (task.status === "running") {
			const elapsed = ((Date.now() - task.createdAt) / 1000).toFixed(1)
			lines.push(`  Elapsed: ${elapsed}s (still running)`)
		}

		// Exit code
		if (task.exitCode !== undefined) {
			lines.push(`  Exit code: ${task.exitCode}`)
		}

		// Changed files
		if (task.changedFiles.length > 0) {
			lines.push(`  Changed files (${task.changedFiles.length}):`)
			for (const f of task.changedFiles.slice(0, 10)) {
				lines.push(`    - ${f}`)
			}
			if (task.changedFiles.length > 10) {
				lines.push(`    ... and ${task.changedFiles.length - 10} more`)
			}
		}

		// Artifacts
		if (task.artifacts.length > 0) {
			lines.push(`  Artifacts (${task.artifacts.length}):`)
			for (const a of task.artifacts.slice(0, 10)) {
				lines.push(`    - ${a}`)
			}
			if (task.artifacts.length > 10) {
				lines.push(`    ... and ${task.artifacts.length - 10} more`)
			}
		}

		// Approval info
		if (task.approvedBy) {
			lines.push(`  Approved by: ${task.approvedBy}`)
		}

		// Retry count
		if (task.retryCount > 0) {
			lines.push(`  Retries: ${task.retryCount}`)
		}

		return lines.join("\n")
	}

	// ─── Artifact helpers (private) ────────────────────────

	/**
	 * Classify a file into an artifact type based on its extension and path.
	 */
	private classifyArtifact(ext: string, filePath: string): Artifact["type"] {
		if (ext === ".diff" || ext === ".patch") return "diff"
		if (ext === ".log" || ext === ".txt") return "log"
		if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return "screenshot"
		if (filePath.includes("/logs/") || filePath.includes("\\logs\\")) return "log"
		if (filePath.includes("/screenshots/") || filePath.includes("\\screenshots\\")) return "screenshot"
		return "file"
	}

	/**
	 * Build Artifact records from a task's existing artifact paths
	 * without hitting the filesystem (uses placeholder sizes).
	 * For accurate sizes, use collectArtifacts() instead.
	 */
	private buildArtifactsFromTask(task: ZeroClawTask): Artifact[] {
		const path = require("path") as typeof import("path")

		return task.artifacts.map((filePath) => {
			const ext = path.extname(filePath).toLowerCase()
			return {
				name: path.basename(filePath),
				path: filePath,
				type: this.classifyArtifact(ext, filePath),
				sizeBytes: 0, // Unknown without fs stat; use collectArtifacts for accurate data
				createdAt: task.createdAt,
			}
		})
	}

	/** Register a listener for task status changes. Returns a disposable to unsubscribe. */
	onStatusChange(listener: StatusListener): vscode.Disposable {
		this.listeners.add(listener)
		return { dispose: () => this.listeners.delete(listener) }
	}

	dispose(): void {
		for (const terminal of this.terminals.values()) {
			terminal.dispose()
		}
		this.terminals.clear()
		for (const timer of this.executionTimers.values()) {
			clearTimeout(timer)
		}
		this.executionTimers.clear()
		this.listeners.clear()
		for (const d of this.disposables) {
			d.dispose()
		}
		this.disposables.length = 0
	}

	// ─── Internal ──────────────────────────────────────────

	private transitionStatus(taskId: string, status: TaskStatus): void {
		const task = this.tasks.get(taskId)
		if (!task) return

		task.status = status
		if (status === "completed" || status === "failed") {
			task.completedAt = Date.now()
		}

		const event: TaskStatusEvent = { taskId, status, task: { ...task } }
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch {
				// Listener errors must not break the service
			}
		}
	}

	private appendLog(taskId: string, line: string): void {
		const task = this.tasks.get(taskId)
		if (!task) return
		const ts = new Date().toISOString().slice(11, 19)
		task.logs.push(`[${ts}] ${line}`)
	}

	private async processQueue(): Promise<void> {
		if (this.processing) return
		this.processing = true

		try {
			while (this.queue.length > 0) {
				const taskId = this.queue.shift()!
				const task = this.tasks.get(taskId)
				if (!task || task.status === "failed") continue

				await this.executeTask(task)
			}
		} finally {
			this.processing = false
		}
	}

	private async executeTask(task: ZeroClawTask): Promise<void> {
		switch (task.riskLevel) {
			case "low":
				await this.executeLowRisk(task)
				break
			case "medium":
				await this.executeMediumRisk(task)
				break
			case "high":
				// High risk tasks should have been approved before reaching here
				await this.executeApproved(task)
				break
		}
	}

	/**
	 * Low risk: auto-execute in a VS Code terminal.
	 * Network/write policies still apply but execution is immediate.
	 */
	private async executeLowRisk(task: ZeroClawTask): Promise<void> {
		this.transitionStatus(task.taskId, "running")
		this.appendLog(task.taskId, "[ZeroClaw] Low-risk auto-execution started")
		this.appendLog(task.taskId, `[ZeroClaw] Network policy: ${task.networkPolicy}`)
		this.appendLog(task.taskId, `[ZeroClaw] Write policy: ${task.writePolicy}`)
		this.appendLog(task.taskId, `[ZeroClaw] Scope: ${task.workspaceScope.join(", ") || "(workspace)"}`)

		await this.runInTerminal(task)
	}

	/**
	 * Medium risk: execute but buffer changes for diff review.
	 * The task runs but writes go to a staging area; the user must
	 * approve the diff before changes land.
	 */
	private async executeMediumRisk(task: ZeroClawTask): Promise<void> {
		this.transitionStatus(task.taskId, "running")
		this.appendLog(task.taskId, "[ZeroClaw] Medium-risk buffered execution started")
		this.appendLog(task.taskId, "[ZeroClaw] Changes will be buffered for diff review")

		// Force buffered write policy for medium risk regardless of user setting
		task.writePolicy = "buffered"
		await this.runInTerminal(task)

		// After terminal execution, if the task completed successfully,
		// transition to blocked so the user can review the diff
		if (task.status === "completed") {
			this.transitionStatus(task.taskId, "blocked")
			task.requiresApproval = true
			this.appendLog(task.taskId, "[ZeroClaw] Buffered changes ready for diff review")
			this.persistHistory()
		}
	}

	/**
	 * High risk: executes only after approval was granted.
	 */
	private async executeApproved(task: ZeroClawTask): Promise<void> {
		this.transitionStatus(task.taskId, "running")
		this.appendLog(task.taskId, `[ZeroClaw] Approved execution started (by ${task.approvedBy ?? "unknown"})`)

		await this.runInTerminal(task)
	}

	/**
	 * Run the task description as a command in a dedicated VS Code terminal.
	 * Enforces timeout limits via an execution timer. Captures the terminal
	 * name for tracking.
	 */
	private async runInTerminal(task: ZeroClawTask): Promise<void> {
		const terminalName = `ZeroClaw: ${task.taskId}`

		const shellPath = process.platform === "win32" ? "cmd.exe" : "/bin/bash"
		const shellFlagArg = process.platform === "win32" ? "/c" : "-c"

		// Build the command with resource constraints
		const envVars: Record<string, string> = {
			ZEROCLAW_TASK_ID: task.taskId,
			ZEROCLAW_RISK_LEVEL: task.riskLevel,
			ZEROCLAW_NETWORK_POLICY: task.networkPolicy,
			ZEROCLAW_WRITE_POLICY: task.writePolicy,
			ZEROCLAW_TIMEOUT_SEC: String(task.limits.timeoutSec),
			ZEROCLAW_MEMORY_MB: String(task.limits.memoryMb),
			ZEROCLAW_CPU: String(task.limits.cpu),
		}

		const terminal = vscode.window.createTerminal({
			name: terminalName,
			cwd: task.projectPath || undefined,
			env: envVars,
			shellPath,
			shellArgs: [shellFlagArg, task.description],
			isTransient: true,
		})

		this.terminals.set(task.taskId, terminal)
		this.appendLog(task.taskId, `[ZeroClaw] Terminal "${terminalName}" created`)

		// Start execution timeout timer
		const timeoutMs = task.limits.timeoutSec * 1000
		this.startExecutionTimer(task.taskId, timeoutMs)

		const completed = await this.waitForTerminalExit(task.taskId, terminal, timeoutMs)

		// Clear the execution timer now that the task has settled
		this.clearExecutionTimer(task.taskId)

		if (!completed) {
			// Timeout: kill the terminal and attempt rollback
			this.appendLog(task.taskId, `[ZeroClaw] Task timed out after ${task.limits.timeoutSec}s`)
			terminal.dispose()
			this.terminals.delete(task.taskId)
			this.rollbackTask(task.taskId)
			this.transitionStatus(task.taskId, "failed")
			task.exitCode = -1
		} else if (task.status === "running") {
			// Terminal exited normally
			this.appendLog(task.taskId, "[ZeroClaw] Task execution completed")
			this.transitionStatus(task.taskId, "completed")
			task.exitCode = 0
		}

		this.persistHistory()
	}

	/**
	 * Wait for a terminal to close, with a timeout.
	 * Returns true if the terminal closed before the timeout.
	 */
	private waitForTerminalExit(taskId: string, terminal: vscode.Terminal, timeoutMs: number): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			let resolved = false

			const cleanup = () => {
				if (resolved) return
				resolved = true
				disposable.dispose()
				clearTimeout(timer)
			}

			const disposable = vscode.window.onDidCloseTerminal((t) => {
				if (t === terminal) {
					cleanup()
					resolve(true)
				}
			})

			const timer = setTimeout(() => {
				if (!resolved) {
					cleanup()
					resolve(false)
				}
			}, timeoutMs)

			// If the terminal was already disposed (e.g. instant command)
			// the onDidCloseTerminal will fire; no extra check needed.
		})
	}

	/**
	 * Best-effort rollback when a task fails mid-execution.
	 * Uses git to restore modified files to their pre-execution state.
	 * Falls back to logging if git is unavailable or the project isn't a git repo.
	 */
	private rollbackTask(taskId: string): void {
		const task = this.tasks.get(taskId)
		if (!task) return

		this.log.info("Rollback started", { taskId })
		this.appendLog(taskId, "[ZeroClaw] Attempting rollback of failed task")

		if (task.changedFiles.length === 0) {
			this.appendLog(taskId, "[ZeroClaw] No changed files recorded — nothing to rollback")
			return
		}

		this.appendLog(taskId, `[ZeroClaw] Files to rollback: ${task.changedFiles.join(", ")}`)

		// Attempt git-based rollback in the task's project directory
		const { execSync } = require("child_process") as typeof import("child_process")
		const cwd = task.projectPath || undefined

		try {
			// First check if this is a git repo
			execSync("git rev-parse --is-inside-work-tree", { cwd, timeout: 5000, stdio: "pipe" })
		} catch {
			this.appendLog(taskId, "[ZeroClaw] Project is not a git repository — cannot rollback via git")
			this.appendLog(taskId, `[ZeroClaw] Manual rollback required for: ${task.changedFiles.join(", ")}`)
			return
		}

		let restoredCount = 0
		let failedCount = 0

		for (const filePath of task.changedFiles) {
			try {
				// Use git checkout to restore the file to its last committed state
				// Escape the file path for shell safety
				const safePath = filePath.replace(/"/g, '\\"')
				execSync(`git checkout -- "${safePath}"`, { cwd, timeout: 10000, stdio: "pipe" })
				restoredCount++
				this.log.info("File restored during rollback", { taskId, filePath })
				this.appendLog(taskId, `[ZeroClaw] Restored: ${filePath}`)
			} catch (err) {
				failedCount++
				const msg = err instanceof Error ? err.message : String(err)
				this.log.warn("Failed to restore file during rollback", { taskId, filePath, error: msg })
				this.appendLog(taskId, `[ZeroClaw] Failed to restore ${filePath}: ${msg}`)
			}
		}

		// Also clean up any untracked files that were created during execution
		try {
			const statusOutput = execSync("git status --porcelain", { cwd, timeout: 10000, encoding: "utf-8" })
			const untrackedLines = statusOutput.split("\n").filter((line: string) => line.startsWith("?? "))
			for (const line of untrackedLines) {
				const untrackedPath = line.slice(3).trim()
				// Only clean untracked files within the task's workspace scope
				const inScope = task.workspaceScope.length === 0 || task.workspaceScope.some((scope) => untrackedPath.startsWith(scope))
				if (inScope) {
					try {
						const fs = require("fs") as typeof import("fs")
						const path = require("path") as typeof import("path")
						const fullPath = path.resolve(cwd ?? ".", untrackedPath)
						fs.unlinkSync(fullPath)
						restoredCount++
						this.appendLog(taskId, `[ZeroClaw] Removed untracked: ${untrackedPath}`)
					} catch {
						// Best-effort: ignore untracked file cleanup failures
					}
				}
			}
		} catch {
			// Best-effort: ignore git status failures
		}

		this.appendLog(taskId, `[ZeroClaw] Rollback complete: ${restoredCount} restored, ${failedCount} failed`)
	}

	/**
	 * Validate a task submission before accepting it.
	 * Checks description, projectPath, and riskLevel for validity.
	 */
	private validateRiskLevel(submission: TaskSubmission): boolean {
		const validRiskLevels: RiskLevel[] = ["low", "medium", "high"]

		if (!submission.description || submission.description.trim().length === 0) {
			this.log.warn("Validation failed: description is empty")
			return false
		}

		if (!submission.projectPath || submission.projectPath.trim().length === 0) {
			this.log.warn("Validation failed: projectPath is empty")
			return false
		}

		if (!validRiskLevels.includes(submission.riskLevel)) {
			this.log.warn("Validation failed: invalid risk level", { riskLevel: submission.riskLevel })
			return false
		}

		return true
	}

	/**
	 * Start an execution timeout timer for a task. If the timer fires,
	 * the task is auto-cancelled.
	 */
	private startExecutionTimer(taskId: string, timeoutMs: number): void {
		this.clearExecutionTimer(taskId)

		const timer = setTimeout(() => {
			const task = this.tasks.get(taskId)
			if (task && task.status === "running") {
				this.appendLog(taskId, `[ZeroClaw] Execution timeout enforced after ${timeoutMs}ms`)
				this.cancel(taskId)
			}
			this.executionTimers.delete(taskId)
		}, timeoutMs)

		this.executionTimers.set(taskId, timer)
	}

	/** Clear the execution timeout timer for a task. */
	private clearExecutionTimer(taskId: string): void {
		const timer = this.executionTimers.get(taskId)
		if (timer) {
			clearTimeout(timer)
			this.executionTimers.delete(taskId)
		}
	}

	/** Persist task history to workspace state so it survives reload. */
	private persistHistory(): void {
		const all = this.getAllTasks().slice(0, MAX_HISTORY)
		this.ctx.workspaceState.update(HISTORY_STATE_KEY, all)
	}
}
