import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Support } from "./backend"
import { resolvePath } from "./path"

// Injected by the CLI build for a packaged binary; absent when running from source.
declare const KILO_NONO_VERSION: string | undefined
declare const KILO_NONO_SHA256: string | undefined

const fallback = "0.82.0"

/** The release the POC expects when no local binary is supplied. */
export const version = typeof KILO_NONO_VERSION === "string" ? KILO_NONO_VERSION : fallback

function manifestFile() {
  return process.env.KILO_NONO_MANIFEST || path.join(import.meta.dir, "..", "script", "nono-manifest.json")
}

const smoke = {
  meta: { name: "kilo-smoke", description: "Probe profile for the nono support check" },
  workdir: { access: "read" },
  filesystem: { allow: [], read: [] },
  network: { block: true },
}

/** Sandbox state root, matching the Kilo sandbox state the host already protects. */
export function root() {
  if (process.env.KILO_NONO_STATE) return path.resolve(process.env.KILO_NONO_STATE)
  return path.resolve(path.join(state(), process.env.OPENCODE_APP_DIR_NAME || "opencode", "sandbox"))
}

function state() {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

export function target() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-${process.arch === "arm64" ? "musl" : "gnu"}`
  return undefined
}

/** nono refuses to start when its state root sits inside a path its default profile reads. */
const unreadable = [
  "/private/var",
  "/var",
  "/private/tmp",
  "/tmp",
  "/opt",
  "/Library",
  "/Applications",
  "/System",
  "/usr",
]

/** Resolves a path that may not exist yet, reusing the sandbox's canonical resolver. */
function canonical(value: string) {
  try {
    return resolvePath(value)
  } catch {
    return path.resolve(value)
  }
}

const unreadableRoots = unreadable.map(canonical)

function inside(parent: string, child: string) {
  const value = canonical(child)
  return value === parent || value.startsWith(parent + path.sep)
}

let resolvedHome: { readonly key: string; readonly value: string } | undefined

/**
 * nono's own config, state, cache and data. It must never overlap a path a profile grants or one nono reads itself,
 * so it lives beside the app state directory and never under the system temporary directories. The launch
 * directory is usually a write grant, and nono refuses a grant that contains its own state root: `bun dev` puts
 * XDG_STATE_HOME inside the checkout, so a candidate under it falls back to the user's state directory.
 */
function home(cwd: string) {
  const key = [process.env.KILO_NONO_HOME || "", state(), os.homedir(), cwd].join("|")
  if (resolvedHome?.key === key) return resolvedHome.value
  const override = process.env.KILO_NONO_HOME || undefined
  const refused = (value: string) =>
    unreadableRoots.some((root) => inside(root, value)) || inside(canonical(cwd), value)
  const candidate = override ? path.resolve(override) : path.resolve(state(), "kilo-nono")
  const fallback = path.join(os.homedir(), ".local", "state", "kilo-nono")
  // A launch grants `cwd`, so neither candidate may sit inside it. The default state directory is already the
  // fallback, so a project that contains the home directory has to say where nono may write.
  if (!override && refused(candidate)) {
    if (refused(fallback)) {
      throw new Error(`nono needs its own state outside ${cwd}; set KILO_NONO_HOME to a directory outside it`)
    }
    resolvedHome = { key, value: fallback }
    return fallback
  }
  resolvedHome = { key, value: candidate }
  return candidate
}

function ensure(dir: string) {
  // Checked rather than remembered: a state directory can be cleaned between launches.
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
}

/**
 * nono reads its config and state only through the XDG roots, so the POC points them at its own protected
 * subtree and never touches a user's system installation.
 */
export function environment(
  base: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
) {
  const nono = home(cwd)
  const roots = {
    config: path.join(nono, "config"),
    state: path.join(nono, "state"),
    cache: path.join(nono, "cache"),
    data: path.join(nono, "data"),
  }
  // nono ignores an XDG root it cannot canonicalize, so the directories must exist before the launch.
  for (const dir of Object.values(roots)) ensure(dir)
  return {
    ...base,
    XDG_CONFIG_HOME: roots.config,
    XDG_STATE_HOME: roots.state,
    XDG_CACHE_HOME: roots.cache,
    XDG_DATA_HOME: roots.data,
  }
}

/** The probe never carries Kilo's environment, so an unexpected binary cannot read secrets or config. */
function probe() {
  return environment({
    HOME: process.env.HOME ?? os.homedir(),
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: os.tmpdir(),
  })
}

function executable(file: string) {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** A packaged build ships nono next to the executable and embeds its digest at build time. */
function packaged() {
  if (typeof KILO_NONO_SHA256 !== "string") return undefined
  return path.join(path.dirname(process.execPath), "nono")
}

function staged() {
  return packaged() ?? path.join(root(), "bin", "nono", version, "nono")
}

function pin() {
  if (typeof KILO_NONO_SHA256 === "string") return KILO_NONO_SHA256
  const name = target()
  if (!name) return undefined
  try {
    const parsed = JSON.parse(readFileSync(manifestFile(), "utf8")) as {
      targets?: Record<string, { binary_sha256?: string }>
    }
    return parsed.targets?.[name]?.binary_sha256
  } catch {
    return undefined
  }
}

/** Rejects a file that is not the pinned release. KILO_NONO_PATH is an explicit developer override. */
function verified(file: string) {
  if (!executable(file)) return `${file} is missing or not executable`
  if ((statSync(file).mode & 0o6000) !== 0) return `${file} is setuid or setgid`
  if (process.env.KILO_NONO_PATH) return undefined
  const expected = pin()
  if (!expected) return "no nono pin is recorded for this target"
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex")
  if (digest !== expected) return `${file} does not match the recorded binary pin`
  return undefined
}

function fingerprint(file: string | undefined) {
  if (!file) return ""
  try {
    const value = statSync(file)
    return `${value.ino}:${value.size}:${value.mtimeMs}`
  } catch {
    return "missing"
  }
}

let resolution: { readonly key: string; readonly value: string | undefined } | undefined

function resolve() {
  const override = process.env.KILO_NONO_PATH || undefined
  const file = override ? path.resolve(override) : staged()
  const key = [file, state(), fingerprint(file)].join("|")
  if (resolution?.key !== key) resolution = { key, value: executable(file) ? file : undefined }
  return resolution.value
}

export function binary() {
  return resolve()
}

interface Checked extends Support {
  /** A timeout or a failed spawn is not a property of the install, so it must not be cached. */
  readonly transient?: boolean
  /** The binary never answered, so a retry would stall the host for the whole probe time again. */
  readonly hung?: boolean
}

/** A transient failure is retried, but not on every call: a hung binary would otherwise stall each launch. */
const retry = 5000

/**
 * `support()` is synchronous by contract, so a probe blocks the caller. Two spawns bound that stop at 7 s: the
 * version check answers in milliseconds, and a first exec that Gatekeeper stalls fails fast instead of stalling.
 */
const versionTimeout = 2000
const dryTimeout = 5000

/** A probe that timed out is re-armed far less often than one that failed for another transient reason. */
const hang = 60000

let cached: { readonly key: string; readonly value: Support; readonly until?: number } | undefined

export function support(): Support {
  const file = resolve()
  const key = [
    process.platform,
    process.arch,
    process.env.KILO_NONO_PATH || "",
    process.env.KILO_NONO_STATE || "",
    process.env.KILO_NONO_HOME || "",
    process.env.XDG_STATE_HOME || "",
    process.cwd(),
    manifestFile(),
    fingerprint(manifestFile()),
    fingerprint(file),
  ].join("|")
  const now = Date.now()
  if (cached?.key === key && (cached.until === undefined || now < cached.until)) return cached.value
  // The status path must never throw at the caller: an unusable state directory is a reason, not a crash.
  try {
    const value = check()
    if (!value.transient) {
      cached = { key, value }
      return value
    }
    cached = { key, value, until: now + (value.hung ? hang : retry) }
    return value
  } catch (cause) {
    const value = {
      available: false,
      reason: `Could not verify nono: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
    cached = { key, value, until: now + retry }
    return value
  }
}

function check(): Checked {
  if (process.platform !== "darwin") return { available: false, reason: "The nono sandbox POC supports macOS only" }
  const file = resolve()
  if (!file) {
    const override = process.env.KILO_NONO_PATH || undefined
    return {
      available: false,
      reason: override
        ? `KILO_NONO_PATH ${override} is not an executable file`
        : `nono ${version} is not staged at ${staged()}`,
    }
  }
  const problem = verified(file)
  if (problem) return { available: false, reason: `Refusing ${file}: ${problem}` }
  const answered = spawnSync(file, ["--version"], { encoding: "utf8", timeout: versionTimeout, env: probe() })
  const reported = `${answered.stdout ?? ""}${answered.stderr ?? ""}`
  if (answered.status !== 0) {
    const detail = reported.trim() || (answered.error?.message ?? `exit ${answered.status}`)
    return {
      available: false,
      reason: `Could not run ${file}: ${detail}`,
      transient: answered.status === null,
      hung: answered.status === null,
    }
  }
  if (!reported.includes(version)) {
    return { available: false, reason: `${file} is not nono ${version}: ${reported.trim()}` }
  }
  ensure(root())
  const dry = spawnSync(
    file,
    ["--silent", "run", "--allow-cwd", "--dry-run", "--profile", prepareSmoke(), "--", "/usr/bin/true"],
    { encoding: "utf8", timeout: dryTimeout, env: probe() },
  )
  if (dry.status !== 0) {
    const detail = (dry.stderr ?? "").trim() || (dry.error?.message ?? `exit ${dry.status}`)
    return {
      available: false,
      reason: `nono rejected a probe profile: ${detail}`,
      transient: dry.status === null,
      hung: dry.status === null,
    }
  }
  return { available: true }
}

function prepareSmoke() {
  ensure(root())
  const file = path.join(root(), "smoke.json")
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, JSON.stringify(smoke, null, 2), { mode: 0o600 })
  renameSync(temporary, file)
  return file
}
