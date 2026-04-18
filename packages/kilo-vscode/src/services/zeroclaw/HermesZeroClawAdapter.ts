import type {
	RiskLevel,
	NetworkPolicy,
	WritePolicy,
	TaskSubmission,
	ZeroClawTask,
} from "./ZeroClawService"

// ─── Hermes-side Types ──────────────────────────────────

/**
 * Represents the result of a Hermes pipeline execution.
 * This is what Hermes produces after processing a TaskEnvelope
 * and (optionally) running planning/validation steps.
 */
export interface HermesExecutionResult {
	/** The Hermes task ID (from TaskEnvelope.task_id). */
	taskId: string
	/** The user's original intent string. */
	userIntent: string
	/** Resolved project path on disk. */
	projectPath: string
	/** Risk tier determined by Hermes policy engine. */
	riskTier: "low" | "medium" | "high"
	/** Whether the task requires actual command execution. */
	requiresExecution: boolean
	/** Constraint snapshot from the original envelope. */
	constraints: {
		allowNetwork: boolean
		allowWrite: boolean
		workspaceScope: string[]
	}
	/** Optional execution plan produced by the planning stage. */
	plan?: string
	/** Timeout override from Hermes policy (seconds). */
	timeoutSec?: number
	/** Memory limit override from Hermes policy (MB). */
	memoryMb?: number
	/** CPU limit override from Hermes policy (fraction 0-1). */
	cpu?: number
}

/**
 * Payload sent back to Hermes after ZeroClaw finishes a task.
 * Hermes uses this to update ledger entries, write memory via Shiba,
 * and surface results to the KiloCode UI.
 */
export interface HermesCompletionPayload {
	/** The original Hermes task ID. */
	hermesTaskId: string
	/** The ZeroClaw-internal task ID. */
	zeroClawTaskId: string
	/** Final outcome. */
	state: "completed" | "failed" | "rolled_back"
	/** Human-readable summary of what happened. */
	summary: string
	/** Exit code from the executed process, if any. */
	exitCode?: number
	/** Wall-clock duration in milliseconds. */
	durationMs: number
	/** Files that were modified during execution. */
	changedFiles: string[]
	/** Paths to output artifacts (logs, diffs, screenshots, etc.). */
	artifacts: string[]
	/** Tail of the execution log (last N lines). */
	logTail: string[]
	/** If the task failed, a structured error. */
	error?: { code: string; message: string }
}

// ─── Default Limits ─────────────────────────────────────

const DEFAULT_LIMITS = {
	low:    { timeoutSec: 120,  memoryMb: 512,  cpu: 0.5 },
	medium: { timeoutSec: 300,  memoryMb: 1024, cpu: 1.0 },
	high:   { timeoutSec: 600,  memoryMb: 2048, cpu: 1.0 },
} as const

const LOG_TAIL_LINES = 50

// ─── Adapter ────────────────────────────────────────────

/**
 * Bridges Hermes pipeline output to ZeroClaw task submission and back.
 *
 * Direction A (Hermes -> ZeroClaw):
 *   HermesExecutionResult  -->  adaptHermesResult()  -->  TaskSubmission
 *
 * Direction B (ZeroClaw -> Hermes):
 *   ZeroClawTask  -->  adaptZeroClawResult()  -->  HermesCompletionPayload
 *
 * This adapter is stateless; all mapping is purely structural.
 */
export class HermesZeroClawAdapter {

	// ── Hermes -> ZeroClaw ────────────────────────────────

	/**
	 * Convert a Hermes execution result into a ZeroClaw TaskSubmission
	 * that can be passed to `ZeroClawService.submit()`.
	 */
	adaptHermesResult(hermesResult: HermesExecutionResult): TaskSubmission {
		const riskLevel = this.mapRiskLevel(hermesResult.riskTier)
		const defaults = DEFAULT_LIMITS[riskLevel]

		return {
			description: this.buildDescription(hermesResult),
			projectPath: hermesResult.projectPath,
			riskLevel,
			workspaceScope: hermesResult.constraints.workspaceScope.join(", "),
			networkPolicy: this.deriveNetworkPolicy(hermesResult),
			writePolicy: this.deriveWritePolicy(hermesResult),
			limits: {
				timeoutSec: hermesResult.timeoutSec ?? defaults.timeoutSec,
				memoryMb: hermesResult.memoryMb ?? defaults.memoryMb,
				cpu: hermesResult.cpu ?? defaults.cpu,
			},
		}
	}

	// ── ZeroClaw -> Hermes ────────────────────────────────

	/**
	 * Convert a completed/failed ZeroClaw task back into a payload
	 * that Hermes can ingest for ledger + memory updates.
	 */
	adaptZeroClawResult(
		task: ZeroClawTask,
		hermesTaskId: string,
	): HermesCompletionPayload {
		const state = this.mapTaskState(task.status)
		const durationMs =
			task.completedAt && task.createdAt
				? task.completedAt - task.createdAt
				: 0

		const payload: HermesCompletionPayload = {
			hermesTaskId,
			zeroClawTaskId: task.taskId,
			state,
			summary: this.buildSummary(task),
			exitCode: task.exitCode,
			durationMs,
			changedFiles: [...task.changedFiles],
			artifacts: [...task.artifacts],
			logTail: task.logs.slice(-LOG_TAIL_LINES),
		}

		if (state === "failed") {
			payload.error = {
				code: task.exitCode !== undefined ? `EXIT_${task.exitCode}` : "TASK_FAILED",
				message: this.extractErrorMessage(task),
			}
		}

		return payload
	}

	// ── Private helpers ───────────────────────────────────

	private mapRiskLevel(tier: HermesExecutionResult["riskTier"]): RiskLevel {
		switch (tier) {
			case "low":    return "low"
			case "medium": return "medium"
			case "high":   return "high"
			default:       return "medium"
		}
	}

	private mapTaskState(
		status: ZeroClawTask["status"],
	): HermesCompletionPayload["state"] {
		switch (status) {
			case "completed": return "completed"
			case "failed":    return "failed"
			default:          return "failed"
		}
	}

	private deriveNetworkPolicy(result: HermesExecutionResult): NetworkPolicy {
		if (!result.constraints.allowNetwork) return "deny"
		if (result.riskTier === "high") return "allowlist"
		return "open"
	}

	private deriveWritePolicy(result: HermesExecutionResult): WritePolicy {
		if (!result.constraints.allowWrite) return "read_only"
		if (result.riskTier === "medium") return "buffered"
		if (result.riskTier === "high") return "approved"
		return "buffered"
	}

	/**
	 * Build the ZeroClaw task description from the Hermes result.
	 * Includes the plan if one was produced during planning.
	 */
	private buildDescription(result: HermesExecutionResult): string {
		let desc = result.userIntent
		if (result.plan) {
			desc += `\n\n--- Hermes Plan ---\n${result.plan}`
		}
		return desc
	}

	/**
	 * Build a human-readable summary of ZeroClaw task execution.
	 */
	private buildSummary(task: ZeroClawTask): string {
		const status = task.status === "completed" ? "completed successfully" : "failed"
		const duration =
			task.completedAt && task.createdAt
				? `${((task.completedAt - task.createdAt) / 1000).toFixed(1)}s`
				: "unknown duration"
		const fileCount = task.changedFiles.length
		const artifactCount = task.artifacts.length

		const parts = [
			`Task ${task.taskId} ${status} (${duration})`,
		]

		if (fileCount > 0) {
			parts.push(`${fileCount} file(s) changed`)
		}
		if (artifactCount > 0) {
			parts.push(`${artifactCount} artifact(s)`)
		}
		if (task.exitCode !== undefined && task.exitCode !== 0) {
			parts.push(`exit code ${task.exitCode}`)
		}

		return parts.join(". ") + "."
	}

	/**
	 * Extract the most relevant error message from a failed task's logs.
	 */
	private extractErrorMessage(task: ZeroClawTask): string {
		// Look for the last log line that mentions an error or failure
		for (let i = task.logs.length - 1; i >= 0; i--) {
			const line = task.logs[i]
			if (
				line.includes("error") ||
				line.includes("Error") ||
				line.includes("failed") ||
				line.includes("Failed") ||
				line.includes("timed out")
			) {
				// Strip the timestamp prefix if present
				const stripped = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")
				return stripped
			}
		}

		if (task.exitCode !== undefined) {
			return `Task exited with code ${task.exitCode}`
		}

		return "Task failed without a specific error message"
	}
}
