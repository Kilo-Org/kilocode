import path from "path"
import { existsSync } from "fs"
import { Global } from "@opencode-ai/core/global"

/**
 * Self-identifying server discovery for agent shell commands.
 *
 * Each VS Code window spawns its own `kilo serve`, and the extension writes
 * one discovery file per server: <state>/vscode-server-<pid>.json (see
 * packages/kilo-vscode/src/services/cli-backend/server-manager.ts). With
 * several windows open, external tooling (e.g. .kilo/daemon/talk.js) cannot
 * tell which file belongs to the window that owns the calling session.
 *
 * Since THIS process is the kilo serve executing the shell tool, it knows
 * its own pid — the exact pid the extension used for the filename. Injecting
 * KILO_SERVER_FILE into the shell env stamps that identity onto every child
 * process, so any script the agent runs targets its own window's server.
 * Environment inheritance is per process tree (macOS and Windows alike), so
 * concurrent windows never see each other's value.
 */
export function resolveServerFile(opts: { stateDir: string; pid: number; client?: string }): string | null {
  if (opts.client !== "vscode") return null
  const file = path.join(opts.stateDir, `vscode-server-${opts.pid}.json`)
  if (!existsSync(file)) return null
  return file
}

export function serverFileEnv(): Record<string, string> {
  const file = resolveServerFile({
    stateDir: Global.Path.state,
    pid: process.pid,
    client: process.env.KILO_CLIENT,
  })
  if (!file) return {}
  return { KILO_SERVER_FILE: file }
}
