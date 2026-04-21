import type { ModelSelection, Provider } from "../types/messages"
import { resolveModelSelection } from "./model-selection"

/**
 * Pure-logic helpers for per-session and global model selection.
 *
 * The SessionProvider delegates to these so the core state transitions
 * can be tested without SolidJS reactivity.
 */

export interface ModelStore {
  /** agentName -> model (global, extension-lifetime) */
  modelSelections: Record<string, ModelSelection | null>
  /** sessionID -> per-session model override */
  sessionOverrides: Record<string, ModelSelection>
  /** sessionID -> agent name */
  agentSelections: Record<string, string>
  recentModels: ModelSelection[]
}

export interface ResolveEnv {
  providers: Record<string, Provider>
  connected: string[]
  fallback: ModelSelection | null
  getModeModel: (agentName: string) => ModelSelection | null
  getGlobalModel: () => ModelSelection | null
}

function resolveModel(
  env: ResolveEnv,
  agentName: string,
  override?: ModelSelection | null,
  recents?: ModelSelection[],
): ModelSelection | null {
  return resolveModelSelection({
    providers: env.providers,
    connected: env.connected,
    override,
    mode: env.getModeModel(agentName),
    global: env.getGlobalModel(),
    recent: recents,
    fallback: env.fallback,
  })
}

/**
 * Returns the model for a specific session, honoring per-session overrides.
 *
 * Precedence: sessionOverride > global modelSelections[agent] > config/default.
 */
export function getSessionModel(
  store: ModelStore,
  env: ResolveEnv,
  sessionID: string,
  defaultAgent: string,
): ModelSelection | null {
  const override = store.sessionOverrides[sessionID]
  if (override) return override
  const agentName = store.agentSelections[sessionID] ?? defaultAgent
  return resolveModel(env, agentName, store.modelSelections[agentName], store.recentModels)
}

/**
 * Returns the model for the "current" view (model picker display).
 *
 * Precedence: sessionOverride[sid] > global modelSelections[agent] > config/default.
 */
export function getSelected(
  store: ModelStore,
  env: ResolveEnv,
  sessionID: string | undefined,
  agentName: string,
): ModelSelection | null {
  if (sessionID) {
    const session = store.sessionOverrides[sessionID]
    if (session) return session
  }
  return resolveModel(env, agentName, store.modelSelections[agentName], store.recentModels)
}

export interface ApplyResult {
  modelSelections: Record<string, ModelSelection | null>
  sessionOverrides: Record<string, ModelSelection>
}

/**
 * Apply a user-initiated model selection.
 *
 * When a session is active, writes ONLY to the per-session override so other
 * sessions are not affected. When no session is active (sidebar), writes to
 * the global modelSelections map.
 */
export function applyModel(
  store: ModelStore,
  agentName: string,
  selection: ModelSelection,
  sessionID: string | undefined,
): ApplyResult {
  const modelSelections = { ...store.modelSelections }
  const sessionOverrides = { ...store.sessionOverrides }

  if (sessionID) {
    // Per-session only — do NOT mutate the global map.  Writing globally
    // here would cause every other session (that hasn't set its own
    // override) to inherit this session's model.
    sessionOverrides[sessionID] = selection
  } else {
    // No active session (sidebar) — write globally
    modelSelections[agentName] = selection
  }

  return { modelSelections, sessionOverrides }
}
