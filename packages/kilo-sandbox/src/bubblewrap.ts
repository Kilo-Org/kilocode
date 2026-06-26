import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, PlatformError } from "effect"
import type { Backend, Launch, Support } from "./backend"
import type { PathRule, Profile } from "./profile"

declare const KILO_BWRAP_SHA256: string | undefined

const system = "/usr/bin/bwrap"

function quote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function command(launch: Launch) {
  if (!launch.shell) return [launch.command, ...launch.args]
  const shell = typeof launch.shell === "string" ? launch.shell : "/bin/sh"
  return [shell, "-c", [launch.command, ...launch.args.map(quote)].join(" ")]
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

function validate(allow: ReadonlyArray<PathRule>, executable: string, mask: string | undefined, mounts: ReadonlyArray<string>) {
  if (allow.some((rule) => beneath(rule.path, executable))) {
    throw new Error(`Bubblewrap executable is writable by the sandbox profile: ${executable}`)
  }
  if (mask && allow.some((rule) => beneath(rule.path, mask))) {
    throw new Error(`Unix-socket mask is writable by the sandbox profile: ${mask}`)
  }

  for (const rule of allow) {
    if (rule.kind !== "subtree") continue
    const nested = mounts.find((mount) => mount !== rule.path && beneath(rule.path, mount))
    if (nested) throw new Error(`Writable root contains a nested mount point: ${nested}`)
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
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

function sockets(profile: Profile) {
  const found = new Set<string>()
  for (const rule of profile.socket?.policy?.paths ?? []) {
    try {
      if (statSync(rule.path).isSocket()) found.add(rule.path)
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") continue
      throw cause
    }
  }
  return [...found].sort((a, b) => a.length - b.length)
}

export function generate(
  profile: Profile,
  launch: Launch,
  executable: string,
  mounts = process.platform === "linux" ? mountpoints() : [],
  mask?: string,
): Launch {
  const allow = writable(profile)
  const blocked = sockets(profile)
  if (blocked.length > 0 && !mask) throw new Error("No trusted Unix-socket mask is available")
  validate(allow, executable, mask, mounts)
  const args = [
    "--unshare-user",
    "--disable-userns",
    "--unshare-pid",
    ...(profile.network.mode === "deny" ? ["--unshare-net"] : []),
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
  if (mask) for (const target of blocked) args.push("--ro-bind", mask, target)
  args.push("--proc", "/proc")
  if (launch.cwd) args.push("--chdir", launch.cwd)
  args.push("--", ...command(launch))

  return {
    ...launch,
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

function invoke(executable: string, capability: "filesystem" | "network" | "socket", mask?: string, target?: string) {
  return spawnSync(
    executable,
    [
      "--unshare-user",
      "--disable-userns",
      "--unshare-pid",
      ...(capability === "network" ? ["--unshare-net"] : []),
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      ...(mask && target ? ["--ro-bind", mask, target] : []),
      "--proc",
      "/proc",
      "--",
      executable,
      "--version",
    ],
    { encoding: "utf8", timeout: 5_000 },
  )
}

function probe(executable: string, capability: "filesystem" | "network" | "socket" = "filesystem", mask?: string) {
  const result =
    capability === "socket" && mask
      ? (() => {
          const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bwrap-socket-"))
          const target = path.join(root, "target")
          try {
            writeFileSync(target, "probe")
            return invoke(executable, capability, mask, target)
          } finally {
            rmSync(root, { recursive: true, force: true })
          }
        })()
      : invoke(executable, capability)
  if (result.status === 0) return undefined
  const detail = result.error?.message ?? (result.stderr.trim() || `exited with status ${result.status}`)
  const name =
    capability === "network"
      ? "Linux network sandbox"
      : capability === "socket"
        ? "Linux Unix-socket authority sandbox"
        : "Linux sandbox"
  return `${executable} could not create the ${name}: ${detail}`
}

function supported(filesystem: boolean, network: boolean, socket: boolean, reason?: string, available = filesystem): Support {
  return {
    available,
    ...(reason ? { reason } : {}),
    capabilities: {
      filesystem,
      network,
      unixSockets: socket,
      unixSocketCoverage: socket ? "known-paths-at-launch" : "none",
    },
  }
}

function masking() {
  const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bwrap-mask-"))
  const target = path.join(root, "mask")
  try {
    writeFileSync(target, "", { mode: 0 })
    chmodSync(target, 0)
    process.once("exit", () => rmSync(root, { recursive: true, force: true }))
    return target
  } catch (cause) {
    rmSync(root, { recursive: true, force: true })
    throw cause
  }
}

interface Selection {
  readonly executable: string | undefined
  readonly support: Support
  network: Support | undefined
  socket: Support | undefined
  mask: string | undefined
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
    if (!failure) {
      return { executable, support: supported(true, false, false), network: undefined, socket: undefined, mask: undefined }
    }
    failures.push(failure)
  }

  return {
    executable: undefined,
    support: supported(false, false, false, failures.at(-1) ?? "No usable Bubblewrap executable is available"),
    network: undefined,
    socket: undefined,
    mask: undefined,
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
          support: supported(false, false, false, "Bubblewrap requires Linux"),
          network: undefined,
          socket: undefined,
          mask: undefined,
        }
  return selected
}

function support(profile?: Profile): Support {
  const selected = selection()
  if (!selected.support.capabilities.filesystem || !selected.executable) return selected.support
  const net = profile?.network.mode === "deny"
  const unix = profile?.socket !== undefined
  if (net && !selected.network) {
    const failure = probe(selected.executable, "network")
    selected.network = supported(true, !failure, false, failure)
  }
  if (unix && !selected.socket) {
    const failure = (() => {
      try {
        selected.mask ??= masking()
        return probe(selected.executable, "socket", selected.mask)
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        return `${selected.executable} could not prepare the Linux Unix-socket authority sandbox: ${detail}`
      }
    })()
    selected.socket = supported(true, false, !failure, failure)
  }
  const reason = (net ? selected.network?.reason : undefined) ?? (unix ? selected.socket?.reason : undefined)
  const network = !net || selected.network?.capabilities.network === true
  const socket = !unix || selected.socket?.capabilities.unixSockets === true
  return supported(true, net && network, unix && socket, reason, network && socket)
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
  prepare: (profile, launch) =>
    Effect.try({
      try: () => {
        const selected = selection()
        return selected.executable ? generate(profile, launch, selected.executable, undefined, selected.mask) : launch
      },
      catch: (cause) => setup(cause, launch),
    }),
}
