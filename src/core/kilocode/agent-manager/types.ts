/**
 * Agent Manager Types
 *
 * Re-exports types from @kilocode/core-schemas for consistency
 * and backward compatibility.
 */

import type { Session as RemoteSession } from "../../../shared/kilocode/cli-sessions/core/SessionClient"

// Re-export all agent manager types from core-schemas
export {
	// Schemas
	agentStatusSchema,
	sessionSourceSchema,
	parallelModeInfoSchema,
	agentSessionSchema,
	pendingSessionSchema,
	agentManagerStateSchema,
	agentManagerMessageSchema,
	agentManagerExtensionMessageSchema,
	availableModelSchema,
	availableModeSchema,
	startSessionMessageSchema,
	// Types
	type AgentStatus,
	type SessionSource,
	type ParallelModeInfo,
	type AgentSession,
	type PendingSession,
	type AgentManagerState,
	type AgentManagerMessage,
	type AgentManagerExtensionMessage,
	type AvailableModel,
	type AvailableMode,
	type StartSessionMessage,
} from "@kilocode/core-schemas"

// Re-export remote session shape from shared session client for consistency
export type { RemoteSession }
