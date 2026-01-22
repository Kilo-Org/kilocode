import * as path from "node:path"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

export function getPlatformDiagnostics(): { platform: "darwin" | "win32" | "linux" | "other"; shell?: string } {
	const platform =
		process.platform === "darwin" || process.platform === "win32" || process.platform === "linux"
			? process.platform
			: "other"

	const shellPath = process.env.SHELL
	const shell = shellPath ? path.basename(shellPath) : undefined

	return { platform, shell }
}

export type AgentManagerLoginIssueType =
	| "cli_outdated"
	| "cli_spawn_error"
	| "cli_configuration_error"
	| "auth_error"
	| "payment_required"
	| "api_error"
	| "session_timeout"

export interface AgentManagerLoginIssueProperties {
	issueType: AgentManagerLoginIssueType
	hasNpm?: boolean
	httpStatusCode?: number
	platform?: "darwin" | "win32" | "linux" | "other"
	shell?: string
	/** For session_timeout: whether stderr had any output */
	hasStderr?: boolean
	/** For session_timeout: first 500 chars of stderr (truncated for privacy) */
	stderrPreview?: string
	/** For session_timeout: whether shell PATH was captured and used */
	hadShellPath?: boolean
	// Spawn error details for debugging Windows issues
	errorMessage?: string
	cliPath?: string
	cliPathExtension?: string
}

export function captureAgentManagerOpened(): void {
	if (!TelemetryService.hasInstance()) return
	TelemetryService.instance.captureEvent(TelemetryEventName.AGENT_MANAGER_OPENED)
}

export function captureAgentManagerSessionStarted(sessionId: string, useWorktree: boolean): void {
	if (!TelemetryService.hasInstance()) return
	TelemetryService.instance.captureEvent(TelemetryEventName.AGENT_MANAGER_SESSION_STARTED, { sessionId, useWorktree })
}

export function captureAgentManagerSessionCompleted(sessionId: string, useWorktree: boolean): void {
	if (!TelemetryService.hasInstance()) return
	TelemetryService.instance.captureEvent(TelemetryEventName.AGENT_MANAGER_SESSION_COMPLETED, {
		sessionId,
		useWorktree,
	})
}

export function captureAgentManagerSessionStopped(sessionId: string, useWorktree: boolean): void {
	if (!TelemetryService.hasInstance()) return
	TelemetryService.instance.captureEvent(TelemetryEventName.AGENT_MANAGER_SESSION_STOPPED, { sessionId, useWorktree })
}

export function captureAgentManagerSessionError(sessionId: string, useWorktree: boolean, error?: string): void {
	if (!TelemetryService.hasInstance()) return
	TelemetryService.instance.captureEvent(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
		sessionId,
		useWorktree,
		error,
	})
}

export function captureAgentManagerLoginIssue(properties: AgentManagerLoginIssueProperties): void {
	if (!TelemetryService.hasInstance()) return
	TelemetryService.instance.captureEvent(TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE, properties)
}
