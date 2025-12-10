import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Agent Manager telemetry helpers.
 * These functions encapsulate the TelemetryService.hasInstance() check
 * and keep telemetry logic co-located with the agent-manager feature.
 */

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
