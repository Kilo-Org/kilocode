import { defaultConfig, ensureHome, getConfig, setConfig } from "./config"
import { DaemonClient } from "./daemon/client"
import { dispatch } from "./daemon/dispatch"
import { parseScript as parseScriptFn } from "./script-parser"
import type { Action, RunOptions, RunResult, WorldConfig, WorldConfigPatch } from "./types"

export { defaultConfig, ensureHome, getConfig, setConfig }
export { DaemonClient }
export { parseScript } from "./script-parser"
export { resolvePath } from "./path"
export type { Action, RunOptions, RunResult, WorldConfig }
export * from "./types"

export namespace World {
  export function configure(patch: WorldConfigPatch): WorldConfig {
    return setConfig(patch)
  }

  export function currentConfig(): WorldConfig {
    return getConfig()
  }

  export const parseScript = (text: string): Action[] => parseScriptFn(text)

  export async function run(script: string, opts: RunOptions = {}): Promise<RunResult> {
    const actions = parseScript(script)
    const startedAt = Date.now()
    const results: RunResult["results"] = []
    let allOk = true
    for (const action of actions) {
      opts.signal?.throwIfAborted()
      const result = await dispatch(action, opts)
      results.push(result)
      if (!result.ok) {
        allOk = false
        break
      }
    }
    return { ok: allOk, durationMs: Date.now() - startedAt, results }
  }

  export async function runForSession(sessionID: string, script: string, opts: RunOptions = {}): Promise<RunResult> {
    return DaemonClient.runViaSession(sessionID, script, opts)
  }

  export async function startDaemon(
    sessionID: string,
    opts: { idleMs?: number } = {},
  ): Promise<DaemonClient.StartResult> {
    return DaemonClient.startDaemon(sessionID, opts)
  }

  export async function setDaemonIdle(sessionID: string, idleMs: number): Promise<DaemonClient.StartResult> {
    return DaemonClient.setIdle(sessionID, idleMs)
  }

  export async function daemonStatus(sessionID: string): Promise<DaemonClient.Status> {
    return DaemonClient.statusOf(sessionID)
  }

  export async function stopDaemon(sessionID: string): Promise<boolean> {
    return DaemonClient.stop(sessionID)
  }
}
