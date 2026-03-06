/**
 * macOS shell environment PATH resolution.
 *
 * When VS Code is launched from Finder, Spotlight, or the Dock, the extension
 * host inherits a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) that excludes
 * directories added by package managers (homebrew, nvm, pipx, etc.) and shell
 * profiles (.zshrc, .bash_profile).
 *
 * This module lazily resolves the user's real PATH by spawning a login shell
 * and caches the result. The fix is applied on first ENOENT and persisted to
 * process.env.PATH so all subsequent child_process calls benefit.
 */

import { type ExecFileOptionsWithStringEncoding, execFile } from "child_process"
import * as os from "os"
import { promisify } from "util"

const run = promisify(execFile)

let cached: Record<string, string> | null = null
let cacheTime = 0
let fallback = false
const TTL = 60_000
const FALLBACK_TTL = 10_000

let fixAttempted = false
let fixSucceeded = false

/**
 * Spawn the user's login shell to capture environment variables (primarily PATH).
 * Uses `-lc` (login + command) — avoids `-i` (interactive) to skip TTY prompts.
 * Results are cached for 1 minute (10 seconds when the fallback was used).
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
  const now = Date.now()
  const ttl = fallback ? FALLBACK_TTL : TTL
  if (cached && now - cacheTime < ttl) return { ...cached }

  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")

  try {
    const { stdout } = await run(shell, ["-lc", "env"], {
      timeout: 10_000,
      env: { ...process.env, HOME: os.homedir() },
    })

    const env: Record<string, string> = {}
    for (const line of stdout.split("\n")) {
      const idx = line.indexOf("=")
      if (idx > 0) {
        env[line.substring(0, idx)] = line.substring(idx + 1)
      }
    }

    cached = env
    cacheTime = now
    fallback = false
    return { ...env }
  } catch (error) {
    console.warn(`[shell-env] Failed to get shell environment: ${error}. Falling back to process.env`)
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value
    }
    cached = env
    cacheTime = now
    fallback = true
    return { ...env }
  }
}

/**
 * Execute a command, retrying once with shell environment on ENOENT.
 *
 * On macOS GUI launches, binaries installed by homebrew / nvm / etc. are not
 * on the inherited PATH. When the first exec fails with ENOENT (command not
 * found), this function resolves the user's login shell environment, patches
 * process.env.PATH permanently, and retries the command.
 */
export async function execWithShellEnv(
  cmd: string,
  args: string[],
  options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(cmd, args, { ...options, encoding: "utf8" })
  } catch (error) {
    if (
      process.platform !== "darwin" ||
      fixSucceeded ||
      fixAttempted ||
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error
    }

    fixAttempted = true
    console.log(`[shell-env] "${cmd}" not found, resolving shell environment`)

    try {
      const env = await getShellEnvironment()

      if (env.PATH) {
        process.env.PATH = env.PATH
        fixSucceeded = true
        console.log("[shell-env] Patched process.env.PATH for GUI app")
      }

      const retry = env.PATH ? { ...env, ...options?.env, PATH: env.PATH } : { ...env, ...options?.env }

      return await run(cmd, args, { ...options, encoding: "utf8", env: retry })
    } catch (retryError) {
      fixAttempted = false
      console.error("[shell-env] Retry failed:", retryError)
      throw retryError
    }
  }
}

/** Clear the cached environment (for tests). */
export function clearShellEnvCache(): void {
  cached = null
  cacheTime = 0
  fallback = false
  fixAttempted = false
  fixSucceeded = false
}
