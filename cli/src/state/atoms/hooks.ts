/**
 * Hooks state atoms
 * Provides global access to hooks configuration for running lifecycle hooks
 */

import { atom } from "jotai"
import type { HooksConfig } from "../../config/types.js"
import {
	runPreToolUseHooks,
	runPostToolUseHooks,
	runPermissionRequestHooks,
	runUserPromptSubmitHooks,
	runNotificationHooks,
	runStopHooks,
	runPreCompactHooks,
	type HookEventResult,
} from "../../hooks/runner.js"
import { logs } from "../../services/logs.js"

/**
 * Atom to hold the loaded hooks configuration
 */
export const hooksConfigAtom = atom<HooksConfig>({})

/**
 * Atom to hold the current session ID for hooks context
 */
export const hooksSessionIdAtom = atom<string | null>(null)

/**
 * Atom to hold the workspace path for hooks context
 */
export const hooksWorkspaceAtom = atom<string>("")

/**
 * Setter atom to initialize hooks configuration
 */
export const setHooksConfigAtom = atom(null, (_get, set, config: HooksConfig) => {
	set(hooksConfigAtom, config)
})

/**
 * Setter atom to set session ID
 */
export const setHooksSessionIdAtom = atom(null, (_get, set, sessionId: string | null) => {
	set(hooksSessionIdAtom, sessionId)
})

/**
 * Setter atom to set workspace
 */
export const setHooksWorkspaceAtom = atom(null, (_get, set, workspace: string) => {
	set(hooksWorkspaceAtom, workspace)
})

/**
 * Derived atom to get hooks context
 */
export const hooksContextAtom = atom((get) => ({
	hooks: get(hooksConfigAtom),
	session_id: get(hooksSessionIdAtom),
	workspace: get(hooksWorkspaceAtom),
}))

/**
 * Helper to build context object without undefined properties
 * This is needed for exactOptionalPropertyTypes compatibility
 */
function buildContext(
	workspace: string | null,
	session_id: string | null,
	taskId?: string,
): { workspace?: string; session_id?: string; taskId?: string } {
	const result: { workspace?: string; session_id?: string; taskId?: string } = {}
	if (workspace) result.workspace = workspace
	if (session_id) result.session_id = session_id
	if (taskId) result.taskId = taskId
	return result
}

// ============================================
// ACTION ATOMS FOR RUNNING HOOKS
// ============================================

/**
 * Action atom to run PreToolUse hooks
 */
export const runPreToolUseHooksAtom = atom(
	null,
	async (get, _set, params: { toolName: string; toolInput: Record<string, unknown> }): Promise<HookEventResult> => {
		const { hooks, session_id, workspace } = get(hooksContextAtom)
		if (Object.keys(hooks).length === 0) {
			return { blocked: false, results: [] }
		}
		logs.debug("Running PreToolUse hooks", "HooksAtom", { toolName: params.toolName })
		return runPreToolUseHooks(hooks, params.toolName, params.toolInput, buildContext(workspace, session_id))
	},
)

/**
 * Action atom to run PostToolUse hooks
 */
export const runPostToolUseHooksAtom = atom(
	null,
	async (
		get,
		_set,
		params: { toolName: string; toolInput: Record<string, unknown>; toolOutput: unknown },
	): Promise<HookEventResult> => {
		const { hooks, session_id, workspace } = get(hooksContextAtom)
		if (Object.keys(hooks).length === 0) {
			return { blocked: false, results: [] }
		}
		logs.debug("Running PostToolUse hooks", "HooksAtom", { toolName: params.toolName })
		return runPostToolUseHooks(
			hooks,
			params.toolName,
			params.toolInput,
			params.toolOutput,
			buildContext(workspace, session_id),
		)
	},
)

/**
 * Action atom to run PermissionRequest hooks
 */
export const runPermissionRequestHooksAtom = atom(
	null,
	async (
		get,
		_set,
		params: { permissionType: string; details: Record<string, unknown> },
	): Promise<HookEventResult> => {
		const { hooks, session_id, workspace } = get(hooksContextAtom)
		if (Object.keys(hooks).length === 0) {
			return { blocked: false, results: [] }
		}
		logs.debug("Running PermissionRequest hooks", "HooksAtom", { permissionType: params.permissionType })
		return runPermissionRequestHooks(
			hooks,
			params.permissionType,
			params.details,
			buildContext(workspace, session_id),
		)
	},
)

/**
 * Action atom to run UserPromptSubmit hooks
 */
export const runUserPromptSubmitHooksAtom = atom(
	null,
	async (get, _set, params: { prompt: string }): Promise<HookEventResult> => {
		const { hooks, session_id, workspace } = get(hooksContextAtom)
		if (Object.keys(hooks).length === 0) {
			return { blocked: false, results: [] }
		}
		logs.debug("Running UserPromptSubmit hooks", "HooksAtom", { promptLength: params.prompt.length })
		return runUserPromptSubmitHooks(hooks, params.prompt, buildContext(workspace, session_id))
	},
)

/**
 * Action atom to run Notification hooks
 */
export const runNotificationHooksAtom = atom(
	null,
	async (
		get,
		_set,
		params: { notificationType: string; details: Record<string, unknown> },
	): Promise<HookEventResult> => {
		const { hooks, session_id, workspace } = get(hooksContextAtom)
		if (Object.keys(hooks).length === 0) {
			return { blocked: false, results: [] }
		}
		logs.debug("Running Notification hooks", "HooksAtom", { notificationType: params.notificationType })
		return runNotificationHooks(hooks, params.notificationType, params.details, buildContext(workspace, session_id))
	},
)

/**
 * Action atom to run Stop hooks
 */
export const runStopHooksAtom = atom(null, async (get, _set, params: { reason: string }): Promise<HookEventResult> => {
	const { hooks, session_id, workspace } = get(hooksContextAtom)
	if (Object.keys(hooks).length === 0) {
		return { blocked: false, results: [] }
	}
	logs.debug("Running Stop hooks", "HooksAtom", { reason: params.reason })
	return runStopHooks(hooks, params.reason, buildContext(workspace, session_id))
})

/**
 * Action atom to run PreCompact hooks
 */
export const runPreCompactHooksAtom = atom(
	null,
	async (get, _set, params: { taskId?: string }): Promise<HookEventResult> => {
		const { hooks, session_id, workspace } = get(hooksContextAtom)
		if (Object.keys(hooks).length === 0) {
			return { blocked: false, results: [] }
		}
		logs.debug("Running PreCompact hooks", "HooksAtom", { taskId: params.taskId })
		return runPreCompactHooks(hooks, buildContext(workspace, session_id, params.taskId))
	},
)
