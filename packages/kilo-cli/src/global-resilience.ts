export * as KiloGlobalResilience from "./global-resilience"

import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

const XDG = ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"] as const

// kilo_port(global:b9f635c56864) - defensively strip newlines from HOME and the XDG bases, and trim
// OPENCODE_TEST_HOME. A trailing newline from `export HOME=$(cmd)` otherwise makes mkdir target
// "<home>\n" and fail EACCES at startup. os.homedir() reads $HOME on POSIX, so cleaning HOME also
// cleans the XDG defaults derived from it.
export function cleanEnv(env: Record<string, string | undefined>) {
  const strip = (value: string) => value.replace(/[\r\n]+/g, "")
  if (env.HOME !== undefined) env.HOME = strip(env.HOME)
  for (const name of XDG) {
    const value = env[name]
    if (value !== undefined) env[name] = strip(value)
  }
  if (env.OPENCODE_TEST_HOME !== undefined) env.OPENCODE_TEST_HOME = env.OPENCODE_TEST_HOME.trim()
}

// kilo_port(global:2886e1a24503) - like fs.mkdir({ recursive: true }) but also repairs a broken
// symlink/junction whose target no longer exists (a Windows edge where a junction points at a deleted
// directory), which otherwise leaves later writes failing ENOENT. A dangling link is an lstat that is a
// symlink whose stat (which follows it) fails. Only a dangling link is repaired: a plain file keeps the
// mkdir error so a caller like resolveState can fall back. Bun throws EEXIST on the mkdir for a dangling
// link while Node no-ops, so the repair runs regardless of whether mkdir threw.
export async function ensureRealDir(p: string) {
  const err = await fs.mkdir(p, { recursive: true }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const dangling =
    (await fs.lstat(p).then(
      (stat) => stat.isSymbolicLink(),
      () => false,
    )) &&
    !(await fs.stat(p).then(
      () => true,
      () => false,
    ))
  if (!dangling) {
    if (err !== undefined) throw err
    return
  }
  await fs.rm(p, { recursive: true, force: true })
  await fs.mkdir(p, { recursive: true })
}

async function writable(p: string) {
  const probe = path.join(p, `.kilo-write-${process.pid}-${randomUUID()}`)
  await fs.writeFile(probe, "", { flag: "wx", mode: 0o600 })
  await fs.unlink(probe)
}

async function ready(p: string) {
  await ensureRealDir(p)
  await writable(p)
}

// kilo_port(global:b9f635c56864) - choose a writable state directory: reuse an existing writable
// fallback (sticky), else the preferred directory, else the fallback with a warning. Throw when the
// preferred fails and there is no fallback, or an AggregateError naming both when both fail.
export async function resolveState(preferred: string, fallback?: string) {
  const sticky =
    fallback === undefined
      ? false
      : await fs.stat(fallback).then(
          (stat) =>
            stat.isDirectory() &&
            writable(fallback).then(
              () => true,
              () => false,
            ),
          () => false,
        )
  if (sticky && fallback !== undefined) return fallback

  const err = await ready(preferred).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (err === undefined) return preferred
  if (fallback === undefined) throw err

  const failed = await ready(fallback).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (failed !== undefined)
    throw new AggregateError([err, failed], `Cannot use state directory "${preferred}" or fallback "${fallback}"`)

  const message = err instanceof Error ? err.message : "Unknown error"
  // Logging is not initialized until the Global paths exist.
  console.warn(`[kilo] Cannot use state directory "${preferred}"; using "${fallback}" instead: ${message}`)
  return fallback
}

const MARKER = ".metadata_never_index"

// kilo_port(global:9f5a3867e9ba) - exclude a Kilo directory from macOS Spotlight indexing by writing an
// empty .metadata_never_index marker (darwin only; ignore an existing marker, warn on other errors).
export async function markNoIndex(dir: string) {
  if (process.platform !== "darwin") return
  await fs.writeFile(path.join(dir, MARKER), "", { flag: "wx" }).catch((err: unknown) => {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "EEXIST") return
    const message = err instanceof Error ? err.message : String(err)
    process.emitWarning(`Failed to mark ${dir} as Spotlight-excluded: ${message}`)
  })
}
