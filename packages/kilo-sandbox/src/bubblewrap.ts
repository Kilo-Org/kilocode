import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, PlatformError } from "effect"
import type { Backend, Launch, Support } from "./backend"
import type { PathRule, Profile } from "./profile"
import type { ProxyRuntime } from "./proxy"

declare const KILO_BWRAP_SHA256: string | undefined
declare const KILO_SANDBOX_NETWORK_RELAY_PATH: string | undefined
declare const KILO_SANDBOX_SECCOMP_PATH: string | undefined

const system = "/usr/bin/bwrap"

function quote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function command(launch: Launch) {
  if (!launch.shell) return [launch.command, ...launch.args]
  const shell = typeof launch.shell === "string" ? launch.shell : "/bin/sh"
  return [shell, "-c", [launch.command, ...launch.args.map(quote)].join(" ")]
}

function relay() {
  if (typeof KILO_SANDBOX_NETWORK_RELAY_PATH === "undefined") {
    return { path: fileURLToPath(new URL("./kilo-sandbox-network-relay.ts", import.meta.url)), environment: {} }
  }
  const target = KILO_SANDBOX_NETWORK_RELAY_PATH.startsWith(".")
    ? fileURLToPath(new URL(KILO_SANDBOX_NETWORK_RELAY_PATH, import.meta.url))
    : path.resolve(path.dirname(process.execPath), KILO_SANDBOX_NETWORK_RELAY_PATH)
  return { path: target, environment: { BUN_BE_BUN: "1" } }
}

function seccomp() {
  if (typeof KILO_SANDBOX_SECCOMP_PATH !== "undefined") {
    return path.resolve(path.dirname(process.execPath), KILO_SANDBOX_SECCOMP_PATH)
  }
  const entry = fileURLToPath(import.meta.resolve("@anthropic-ai/sandbox-runtime"))
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : undefined
  return arch ? path.resolve(path.dirname(entry), "../vendor/seccomp", arch, "apply-seccomp") : undefined
}

function exists(rule: PathRule) {
  if (!existsSync(rule.path)) return false
  const entry = statSync(rule.path)
  if (rule.kind === "literal") return entry.isFile()
  return entry.isDirectory()
}

function writable(profile: Profile) {
  const seen = new Set<string>()
  return profile.filesystem.allowWrite
    .filter(exists)
    .filter((rule) => {
      if (seen.has(rule.path)) return false
      seen.add(rule.path)
      return true
    })
    .sort((a, b) => a.path.length - b.path.length)
}

function beneath(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function unescape(value: string) {
  return value.replace(/\\([0-7]{3})/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 8)))
}

export function parseMountinfo(content: string) {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = line.split(" ")[4]
      if (!value) throw new Error("Could not parse /proc/self/mountinfo")
      return unescape(value)
    })
}

function mountpoints() {
  return parseMountinfo(readFileSync("/proc/self/mountinfo", "utf8"))
}

function validate(allow: ReadonlyArray<PathRule>, executable: string, mounts: ReadonlyArray<string>) {
  if (allow.some((rule) => beneath(rule.path, executable))) {
    throw new Error(`Bubblewrap executable is writable by the sandbox profile: ${executable}`)
  }

  for (const rule of allow) {
    if (rule.kind !== "subtree") continue
    const nested = mounts.find((mount) => mount !== rule.path && beneath(rule.path, mount))
    if (nested) throw new Error(`Writable root contains a nested mount point: ${nested}`)
  }
}

function code(cause: unknown) {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined
  const value = (cause as { code: unknown }).code
  return typeof value === "string" ? value : undefined
}

// Lists one directory during the deny-name scan. A directory that vanished mid-scan
// (ENOENT/ENOTDIR) is treated as empty, and an unreadable directory (EACCES/EPERM)
// yields undefined so the caller can protect it instead of failing the whole scan.
function list(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (cause) {
    const tag = code(cause)
    if (tag === "ENOENT" || tag === "ENOTDIR") return []
    if (tag === "EACCES" || tag === "EPERM") return undefined
    throw cause
  }
}

function scan(root: string, names: ReadonlySet<string>, found: Set<string>) {
  if (names.has(path.basename(root))) {
    found.add(root)
    return
  }
  if (!statSync(root).isDirectory()) return

  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop()
    if (!dir) continue
    const entries = list(dir)
    if (!entries) {
      // Fail closed: a nested directory that cannot be enumerated might hide a deny-name
      // match, so it is re-bound read-only as a whole rather than aborting sandbox setup.
      // The writable root itself must stay readable, or there is nothing to scan.
      if (dir === root) throw new Error(`Writable root is not readable: ${root}`)
      found.add(dir)
      continue
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (names.has(entry.name)) {
        found.add(target)
        continue
      }
      if (entry.isDirectory()) pending.push(target)
    }
  }
}

function protectedPaths(profile: Profile, allow: ReadonlyArray<PathRule>) {
  const found = new Set(profile.filesystem.denyWrite.filter((rule) => existsSync(rule.path)).map((rule) => rule.path))
  if (profile.filesystem.denyNames.length === 0) return [...found]

  const names = new Set(profile.filesystem.denyNames)
  for (const rule of allow) {
    if (rule.kind === "subtree") scan(rule.path, names, found)
  }
  return [...found].sort((a, b) => a.length - b.length)
}

export function generate(
  profile: Profile,
  launch: Launch,
  executable: string,
  mounts = process.platform === "linux" ? mountpoints() : [],
  proxy?: ProxyRuntime,
): Launch {
  const allow = writable(profile)
  validate(allow, executable, mounts)
  const worker = profile.network.mode === "proxy" ? relay() : undefined
  const filter = profile.network.mode === "proxy" ? seccomp() : undefined
  if (profile.network.mode === "proxy" && (!proxy?.socket || !worker || !filter)) {
    throw new Error("Linux sandbox proxy dependencies are unavailable")
  }
  if (worker) validate(allow, worker.path, mounts)
  if (filter) validate(allow, filter, mounts)
  if (worker) validate(allow, process.execPath, mounts)
  const args = [
    "--unshare-user",
    "--disable-userns",
    "--unshare-pid",
    ...(profile.network.mode !== "allow" ? ["--unshare-net"] : []),
    ...(profile.network.mode === "proxy" ? ["--cap-add", "cap_sys_admin"] : []),
    "--die-with-parent",
    "--new-session",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
  ]

  for (const rule of allow) args.push("--bind", rule.path, rule.path)
  for (const target of protectedPaths(profile, allow)) args.push("--ro-bind", target, target)
  if (proxy?.socket) args.push("--ro-bind", proxy.socket, proxy.socket)
  args.push("--proc", "/proc")
  if (launch.cwd) args.push("--chdir", launch.cwd)
  const target = command(launch)
  args.push(
    "--",
    ...(worker && filter && proxy?.socket
      ? [process.execPath, worker.path, proxy.socket, filter, "--", ...target]
      : target),
  )

  return {
    ...launch,
    environment: worker ? { ...launch.environment, ...worker.environment } : launch.environment,
    command: executable,
    args,
  }
}

function bundled() {
  return path.join(path.dirname(process.execPath), "bwrap")
}

function digest() {
  return typeof KILO_BWRAP_SHA256 === "undefined" ? undefined : KILO_BWRAP_SHA256
}

function resolve(executable: string, expected?: string) {
  try {
    if (!path.isAbsolute(executable)) return
    const target = realpathSync.native(executable)
    const entry = statSync(target)
    if (!entry.isFile() || (entry.mode & 0o6000) !== 0) return
    if (expected && createHash("sha256").update(readFileSync(target)).digest("hex") !== expected) return
    return target
  } catch {
    return
  }
}

function probe(executable: string, network = false) {
  const result = spawnSync(
    executable,
    [
      "--unshare-user",
      "--disable-userns",
      "--unshare-pid",
      ...(network ? ["--unshare-net"] : []),
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--",
      executable,
      "--version",
    ],
    { encoding: "utf8", timeout: 5_000 },
  )
  if (result.status === 0) return undefined
  const detail = result.error?.message ?? (result.stderr.trim() || `exited with status ${result.status}`)
  const capability = network ? "Linux network sandbox" : "Linux sandbox"
  return `${executable} could not create the ${capability}: ${detail}`
}

interface Selection {
  readonly executable: string | undefined
  readonly support: Support
  network: Support | undefined
  proxy: Support | undefined
}

function select(): Selection {
  const override = process.env.KILO_BWRAP_PATH
  const candidates = override
    ? [{ executable: override }]
    : [{ executable: system }, { executable: bundled(), expected: digest() }]
  const failures: Array<string> = []

  for (const candidate of candidates) {
    const executable = resolve(candidate.executable, candidate.expected)
    if (!executable) continue
    const failure = probe(executable)
    if (!failure) return { executable, support: { available: true } satisfies Support, network: undefined, proxy: undefined }
    failures.push(failure)
  }

  return {
    executable: undefined,
    support: {
      available: false,
      reason: failures.at(-1) ?? "No usable Bubblewrap executable is available",
    } satisfies Support,
    network: undefined,
    proxy: undefined,
  }
}

let selected: Selection | undefined

function selection(): Selection {
  if (selected) return selected
  selected =
    process.platform === "linux"
      ? select()
      : {
          executable: undefined,
          support: { available: false, reason: "Bubblewrap requires Linux" } satisfies Support,
          network: undefined,
          proxy: undefined,
        }
  return selected
}

function support(network?: Profile["network"]): Support {
  const selected = selection()
  if (!selected.support.available || !network || network.mode === "allow" || !selected.executable) return selected.support
  if (network?.mode === "proxy" && selected.proxy) return selected.proxy
  if (network?.mode === "deny" && selected.network) return selected.network
  const failure = probe(selected.executable, true)
  if (failure) {
    const value = { available: false, reason: failure }
    if (network?.mode === "proxy") selected.proxy = value
    else selected.network = value
  }
  else if (network?.mode === "proxy") {
    const worker = relay().path
    const filter = seccomp()
    const missing = !existsSync(worker)
      ? worker
      : filter === undefined
        ? "unsupported architecture"
        : !existsSync(filter)
          ? filter
          : undefined
    selected.proxy = missing
      ? { available: false, reason: `Linux sandbox proxy dependency is unavailable: ${missing ?? "unsupported architecture"}` }
      : { available: true }
  } else selected.network = { available: true }
  return network?.mode === "proxy" ? selected.proxy! : selected.network!
}

function setup(cause: unknown, launch: Launch) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method: "prepareCommand",
    pathOrDescriptor: launch.command,
    description: cause instanceof Error ? cause.message : "Could not construct the Linux sandbox",
    cause,
  })
}

export const bubblewrap: Backend = {
  support,
  prepare: (profile, launch, proxy) =>
    Effect.try({
      try: () => {
        const selected = selection()
        return selected.executable ? generate(profile, launch, selected.executable, undefined, proxy) : launch
      },
      catch: (cause) => setup(cause, launch),
    }),
}
