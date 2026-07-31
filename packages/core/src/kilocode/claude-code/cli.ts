// Discovery and probing for the Claude Code CLI.
//
// The CLI owns its own credentials (subscription OAuth stored in the user's
// keychain / ~/.claude). We never read or extract those tokens: Anthropic
// explicitly rejects Claude Code credentials used against the raw API
// ("This credential is only authorized for use with Claude Code"). Instead we
// drive the officially supported headless mode and let the CLI authenticate
// itself, which is what makes Pro/Max/Team/Enterprise plans usable here.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export const BIN_ENV = "KILO_CLAUDE_CODE_PATH"

const WINDOWS = process.platform === "win32"

function discover(): string | undefined {
  const override = process.env[BIN_ENV]
  if (override) return existsSync(override) ? override : undefined
  const home = homedir()
  const names = WINDOWS ? ["claude.exe", "claude.cmd", "claude.bat"] : ["claude"]
  const raw = process.env.PATH ?? process.env.Path ?? ""
  // PATH first, then well-known install locations — GUI editors frequently
  // inherit a narrower PATH than the user's shell.
  const dirs = [
    ...raw.split(path.delimiter).filter(Boolean),
    path.join(home, ".claude", "local"),
    path.join(home, ".local", "bin"),
    path.join(home, "AppData", "Local", "Programs", "claude"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name)
      if (existsSync(full)) return full
    }
  }
  return undefined
}

// Resolution is a handful of stat calls, but it runs on the catalog hot path,
// so memoize it. `reset` exists for tests.
let cached: string | undefined
let probed = false

/** Resolve the Claude Code binary, or undefined when it is not installed. */
export function resolveBin(): string | undefined {
  if (!probed) {
    cached = discover()
    probed = true
  }
  return cached
}

export function reset(): void {
  probed = false
  cached = undefined
}

export type Probe = {
  version: string
  loggedIn: boolean
  /**
   * "claude.ai" for a genuine Pro/Max/Team/Enterprise subscription login.
   * Any other value (live-verified: a bearer token from a custom
   * ANTHROPIC_AUTH_TOKEN gateway, or an API-key based login) means the CLI
   * is authenticated some other way and is not billing against a Claude
   * subscription.
   */
  authMethod?: string
}

function run(bin: string, args: string[], timeout: number): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let settled = false
    const done = (result: { code: number; stdout: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timer = setTimeout(() => {
      // A child that ignores the kill signal (blocked I/O, defunct state,
      // etc.) would otherwise leave this promise pending forever, wedging
      // whoever awaits it — resolve immediately rather than relying on
      // `close` to fire after killing.
      child.kill()
      done({ code: -1, stdout })
    }, timeout)
    child.stdout?.on("data", (chunk) => (stdout += chunk))
    child.on("error", () => {
      clearTimeout(timer)
      done({ code: -1, stdout: "" })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      done({ code: code ?? -1, stdout })
    })
  })
}

/**
 * Ask the CLI whether it is installed and signed in.
 *
 * `claude auth status` prints JSON like
 * `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}` for
 * a genuine subscription login (live-verified; the CLI's own docs/examples
 * are not authoritative here — `authMethod` values were confirmed empirically
 * against a real account, not assumed).
 */
export async function probe(bin = resolveBin()): Promise<Probe | undefined> {
  if (!bin) return undefined
  const version = await run(bin, ["--version"], 15_000)
  if (version.code !== 0) return undefined
  const status = await run(bin, ["auth", "status"], 15_000)
  const parsed = (() => {
    const text = status.stdout.trim()
    if (!text.startsWith("{")) return undefined
    try {
      return JSON.parse(text) as { loggedIn?: boolean; authMethod?: string }
    } catch {
      return undefined
    }
  })()
  return {
    version: version.stdout.trim(),
    loggedIn: parsed?.loggedIn === true,
    authMethod: parsed?.authMethod,
  }
}
