/**
 * The agent map of a session: the session itself, every agent it started
 * directly or through another agent, and the background processes they run.
 */

/**
 * How a node joined the map.
 * - `root`: the top session of the family.
 * - `task`: a Task tool subagent, a child session of its parent.
 * - `session`: an Agent Manager session that an `agent_manager` call started.
 * - `process`: a background process that a session started.
 */
export type AgentMapKind = "root" | "task" | "session" | "process"

export type AgentMapStatus = "running" | "waiting" | "done" | "error" | "cancelled"

export interface AgentMapTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface AgentMapNode {
  id: string
  kind: AgentMapKind
  /** The node that started this one. Absent on the root. */
  parent?: string
  title: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  status: AgentMapStatus
  /** A Task agent that runs in the background. */
  background?: boolean
  started: number
  /** When the node stopped working. Absent while it runs or waits. */
  finished?: number
  tokens?: AgentMapTokens
  cost?: number
  /** The command of a background process. */
  command?: string
  pid?: number
  ports?: number[]
}

export interface AgentMap {
  /** The session the map was requested for. */
  root: string
  /** The root first, then each level in start order. */
  nodes: AgentMapNode[]
  /** True when nodes past the size limit were left out. */
  truncated?: boolean
}

export interface RequestAgentMapMessage {
  type: "requestAgentMap"
  sessionID: string
  requestID: string
}

export interface StopBackgroundProcessMessage {
  type: "stopBackgroundProcess"
  sessionID: string
  processID: string
}

export interface AgentMapLoadedMessage {
  type: "agentMapLoaded"
  sessionID: string
  requestID: string
  map?: AgentMap
  error?: string
}
