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

import { type ExecFileOptionsWithStringEncoding } from "child_process"
import * as os from "os"
import { exec } from "../util/process"

// Environment variable keys match: letters, digits, underscores, starting with a non-digit.
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

let cached: Record<string, string> | null = null
let cacheTime = 0
let wasFallback = false
const TTL = 60_000
const FALLBACK_TTL = 10_000

/** In-flight fix promise so concurrent ENOENT callers wait on the same resolution. */
let fixing: Promise<boolean> | null = null
let fixed = false

/**
 * Parse `env` output, handling multiline variable values correctly.
 *
 * A new entry starts when a line matches `KEY=value` (KEY is a valid
 * environment variable name). Lines that don't match are continuations
 * of the previous value.
 */
function parseEnvOutput(stdout: string): Record<string, string> {
  const env: Record<string, string> = {}
  let key: string | null = null
  let value = ""

  for (const line of stdout.split("\n")) {
    const match = ENV_KEY_RE.exec(line)
    if (match) {
      if (key) env[key] = value
      const idx = match[0].length - 1 // position of '='
      key = line.substring(0, idx)
      value = line.substring(idx + 1)
    } else if (key) {
      value += "\n" + line
    }
  }
  if (key) env[key] = value
  return env
}

/**
 * Spawn the user's login shell to capture environment variables (primarily PATH).
 * Uses `-lc` (login + command) — avoids `-i` (interactive) to skip TTY prompts.
 * Results are cached for 1 minute (10 seconds when the fallback was used).
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
  const now = Date.now()
  const ttl = wasFallback ? FALLBACK_TTL : TTL
  if (cached && now - cacheTime < ttl) return { ...cached }

  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")

  try {
    const { stdout } = await exec(shell, ["-lc", "env"], {
      timeout: 10_000,
      env: { ...process.env, HOME: os.homedir() },
    })

    const env = parseEnvOutput(stdout)
    cached = env
    cacheTime = now
    wasFallback = false
    return { ...env }
  } catch (error) {
    console.warn(`[shell-env] Failed to get shell environment: ${error}. Falling back to process.env`)
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value
    }
    cached = env
    cacheTime = now
    wasFallback = true
    return { ...env }
  }
}

/**
 * Attempt to resolve the shell environment and patch process.env.PATH.
 * Returns true if PATH was actually changed, false otherwise.
 */
async function resolvePath(): Promise<boolean> {
  const original = process.env.PATH
  const env = await getShellEnvironment()

  if (env.PATH && env.PATH !== original) {
    process.env.PATH = env.PATH
    console.log("[shell-env] Patched process.env.PATH for GUI app")
    return true
  }
  // Shell env was a fallback or PATH didn't change — resolution didn't help
  return false
}

/**
 * Execute a command, retrying once with shell environment on ENOENT.
 *
 * On macOS GUI launches, binaries installed by homebrew / nvm / etc. are not
 * on the inherited PATH. When the first exec fails with ENOENT (command not
 * found), this function resolves the user's login shell environment, patches
 * process.env.PATH permanently, and retries the command.
 *
 * Concurrent callers that hit ENOENT share a single resolution promise so
 * none are rejected prematurely.
 */
export async function execWithShellEnv(
  cmd: string,
  args: string[],
  options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec(cmd, args, options)
  } catch (error) {
    if (
      process.platform !== "darwin" ||
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error
    }

    // Already resolved and PATH was actually changed — no point retrying resolution.
    // Just retry with the (already-patched) process.env.
    if (fixed) {
      return await exec(cmd, args, options)
    }

    // If another caller is already resolving, wait for it then retry.
    if (fixing) {
      await fixing
      return await exec(cmd, args, options)
    }

    console.log(`[shell-env] "${cmd}" not found, resolving shell environment`)

    fixing = resolvePath()
    try {
      fixed = await fixing
    } finally {
      fixing = null
    }

    return await exec(cmd, args, options)
  }
}

/** Clear the cached environment (for tests). */
export function clearShellEnvCache(): void {
  cached = null
  cacheTime = 0
  wasFallback = false
  fixing = null
  fixed = false
}
