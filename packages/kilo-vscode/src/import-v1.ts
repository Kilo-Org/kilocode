// The temporary "Import from Kilo v1" action for internal users until the release migration lands. It runs
// `kilo2 import v1` with the same command and environment as the server, so it writes the store and config directory
// that server reads, also from a repository checkout with its isolated profile.
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { environment, type Command } from "./server"
import { collected, launch } from "./process"

export function importV1(input: {
  command: Command
  cwd: string
  env: NodeJS.ProcessEnv
  days: number
  log: (text: string) => void
  signal?: AbortSignal
}): Promise<{ ok: boolean; output: string }> {
  const prefix = input.command.args.slice(0, input.command.args.indexOf("serve"))
  const args = [...prefix, "import", "v1", "--since", `${input.days}d`, "--config"]
  const child = launch(input.command.cmd, args, {
    cwd: input.cwd,
    env: environment(input.env, { ...input.command.env, INIT_CWD: input.cwd }),
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so a stop also reaches the CLI that the dev entry of a checkout starts.
    detached: process.platform !== "win32",
  })
  // The CLI converts into a private store and merges in one transaction, so stopping it leaves kilo2 as it was.
  input.signal?.addEventListener("abort", () => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
    if (process.platform === "win32") return void child.kill()
    // The group can end between the check and the signal; there is nothing left to stop then.
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  })
  return collected(child, input.log)
}

/**
 * The Kilo v1 session store, when this machine has one: `kilo/kilo.db` in the XDG data directory, as v1 places it, or
 * in the default one under the home directory, where the CLI looks too when the XDG directory has none.
 */
export function v1Store(env: NodeJS.ProcessEnv, home = homedir()) {
  const fallback = path.join(home, ".local", "share")
  return [env.XDG_DATA_HOME || fallback, fallback]
    .map((dir) => path.join(dir, "kilo", "kilo.db"))
    .find((file) => existsSync(file))
}

/** The counts of a successful `kilo2 import v1` run, read from its output lines. */
export function summarize(output: string) {
  return {
    sessions: Number(/^Imported (\d+)/m.exec(output)?.[1] ?? 0),
    config: /^Copied the Kilo v1 config (.+?) from /m.exec(output)?.[1].split(", ") ?? [],
  }
}
