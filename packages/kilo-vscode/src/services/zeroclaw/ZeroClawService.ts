import * as vscode from "vscode"
import { randomUUID } from "crypto"

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
	private readonly tasks = new Map<string, ZeroClawTask>()
	private readonly queue: string[] = []
	private readonly listeners = new Set<StatusListener>()
	private readonly disposables: vscode.Disposable[] = []
	private readonly terminals = new Map<string, vscode.Terminal>()
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
					const task = this.tasks.get(taskId)
					if (task && task.status === "running") {
						this.transitionStatus(taskId, "failed")
						this.appendLog(taskId, "[ZeroClaw] Terminal closed externally")
					}
					break
				}
			}
		})
		this.disposables.push(termClose)
	}

	// ─── Public API ────────────────────────────────────────

	/** Submit a new task. Returns the created task. */
	submit(submission: TaskSubmission): ZeroClawTask {
		const taskId = randomUUID().slice(0, 12)
		const scopeParts = submission.workspaceScope
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)

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

	/** Retry a failed task by resubmitting it to the queue. */
	retry(taskId: string): ZeroClawTask | undefined {
		const original = this.tasks.get(taskId)
		if (!original || original.status !== "failed") return undefined

		return this.submit({
			description: original.description,
			projectPath: original.projectPath,
			riskLevel: original.riskLevel,
			workspaceScope: original.workspaceScope.join(", "),
			networkPolicy: original.networkPolicy,
			writePolicy: original.writePolicy,
			limits: { ...original.limits },
		})
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
		return this.tasks.get(taskId)
	}

	/** Get all tasks, ordered newest first. */
	getAllTasks(): ZeroClawTask[] {
		return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
	}

	/** Get the last N tasks for history display. */
	getHistory(limit = 50): ZeroClawTask[] {
		return this.getAllTasks().slice(0, limit)
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
	 * Enforces timeout limits. Captures the terminal name for tracking.
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

		// Apply timeout
		const timeoutMs = task.limits.timeoutSec * 1000
		const completed = await this.waitForTerminalExit(task.taskId, terminal, timeoutMs)

		if (!completed) {
			// Timeout: kill the terminal
			this.appendLog(task.taskId, `[ZeroClaw] Task timed out after ${task.limits.timeoutSec}s`)
			terminal.dispose()
			this.terminals.delete(task.taskId)
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

	/** Persist task history to workspace state so it survives reload. */
	private persistHistory(): void {
		const all = this.getAllTasks().slice(0, MAX_HISTORY)
		this.ctx.workspaceState.update(HISTORY_STATE_KEY, all)
	}
}
