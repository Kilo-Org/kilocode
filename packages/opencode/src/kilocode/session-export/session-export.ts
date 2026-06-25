import type { Agent } from "@/agent/agent"

// Stubbed for Relay: the upstream session-export pipeline uploaded full session
// payloads (prompts + responses) to supermassive-black-hole.kiloapps.io. The
// public API is preserved as no-ops so external callers in session/llm.ts,
// session/session.ts, session/compaction.ts and the bootstrap remain intact.
// A real telemetry/export backend for Relay can be wired up later behind this
// same surface without touching call sites.

type InitOpts = {
  agentVersion: string
  dbPath: string
  endpoint?: string
  surface?: string
  anonId?: string
  snapshotProvider?: unknown
  workspaceKey?: string
  syncSeq?: (sessionId: string) => number
  subscribeAll: (cb: (event: unknown) => void) => () => void
  createWorker?: (url: string | URL) => Worker
}

export const init = (_opts: InitOpts): void => {}

export const beforeRequest = (..._args: unknown[]): void => {}

export const afterRequest = (..._args: unknown[]): void => {}

export const compaction = (_args: unknown): void => {}

export const agentInfo = (info: Agent.Info): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    name: info.name,
    mode: info.mode,
  }
  if (info.displayName !== undefined) out.displayName = info.displayName
  if (info.description !== undefined) out.description = info.description
  if (info.deprecated !== undefined) out.deprecated = info.deprecated
  if (info.native !== undefined) out.native = info.native
  if (info.hidden !== undefined) out.hidden = info.hidden
  return out
}

export const onSessionClose = async (_sessionId: string, _workspaceKey?: string): Promise<void> => {}

export const shutdown = async (): Promise<void> => {}
