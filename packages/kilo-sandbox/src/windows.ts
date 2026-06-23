import { closeSync, existsSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, PlatformError } from "effect"
import type { Backend, Launch, Support } from "./backend"
import type { PathRule, Profile } from "./profile"

export const protocol = 1
const executable = "kilo-sandbox-windows.exe"
const prototype = process.env.KILO_WINDOWS_SANDBOX_PROTOTYPE === "1"
const limit = {
  args: 4096,
  rules: 4096,
  names: 1024,
  text: 32 * 1024,
  request: 1024 * 1024,
} as const

export interface WindowsRequest {
  readonly version: number
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly allowWrite: ReadonlyArray<PathRule>
  readonly denyWrite: ReadonlyArray<PathRule>
  readonly denyNames: ReadonlyArray<string>
  readonly temporaryDirectory?: string | undefined
}

function value(env: Readonly<Record<string, string | undefined>>, key: string) {
  const found = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : env[found]
}

function extensions(env: Readonly<Record<string, string | undefined>>) {
  const source = value(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD"
  return source
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(".") && !item.includes("/") && !item.includes("\\"))
}

function candidates(command: string, env: Readonly<Record<string, string | undefined>>) {
  if (path.win32.extname(command)) return [command]
  return extensions(env).map((ext) => `${command}${ext}`)
}

function file(target: string) {
  try {
    return statSync(target).isFile()
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") return false
    throw err
  }
}

export function resolveExecutable(
  command: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  exists: (target: string) => boolean = file,
) {
  const direct = path.win32.isAbsolute(command) || command.includes("/") || command.includes("\\")
  const roots = direct
    ? [path.win32.isAbsolute(command) ? "" : cwd]
    : (value(env, "PATH") ?? "")
        .split(";")
        .filter((item) => item.length > 0)
  for (const root of roots) {
    for (const candidate of candidates(command, env)) {
      const target = path.win32.resolve(root, candidate)
      if (exists(target)) return target
    }
  }
  return undefined
}

function text(value: string) {
  return value.length <= limit.text && !value.includes("\0")
}

function bounded(values: ReadonlyArray<string>, max: number) {
  return values.length <= max && values.every(text)
}

export function request(profile: Profile, launch: Launch, command: string): WindowsRequest | undefined {
  const rules = [...profile.filesystem.allowWrite, ...profile.filesystem.denyWrite]
  if (!text(command) || launch.cwd === undefined || !text(launch.cwd)) return undefined
  if (!bounded(launch.args, limit.args) || !bounded(profile.filesystem.denyNames, limit.names)) return undefined
  if (rules.length > limit.rules || rules.some((rule) => !text(rule.path))) return undefined
  if (profile.filesystem.temporaryDirectory !== undefined && !text(profile.filesystem.temporaryDirectory)) return undefined
  const result: WindowsRequest = {
    version: protocol,
    command,
    args: launch.args,
    cwd: launch.cwd,
    allowWrite: profile.filesystem.allowWrite,
    denyWrite: profile.filesystem.denyWrite,
    denyNames: profile.filesystem.denyNames,
    ...(profile.filesystem.temporaryDirectory === undefined
      ? {}
      : { temporaryDirectory: profile.filesystem.temporaryDirectory }),
  }
  return Buffer.byteLength(JSON.stringify(result), "utf8") <= limit.request ? result : undefined
}

function failure(command: string, description: string, cause?: unknown) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method: "prepareWindowsCommand",
    pathOrDescriptor: command,
    description,
    cause,
  })
}

function helper() {
  const override = process.env.KILO_WINDOWS_SANDBOX_HELPER
  const dev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test"
  if (dev && override && path.win32.isAbsolute(override)) return override
  return path.join(path.dirname(process.execPath), executable)
}

function sanitize(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => {
      const name = key.toUpperCase()
      return (
        name !== "KILO_WINDOWS_SANDBOX_HELPER" &&
        name !== "KILO_WINDOWS_SANDBOX_PROBE" &&
        name !== "KILO_WINDOWS_SANDBOX_PROTOTYPE"
      )
    }),
  )
}

export function generate(
  profile: Profile,
  launch: Launch,
  bin = helper(),
  exists: (target: string) => boolean = file,
  ready: (target: string) => boolean = existsSync,
) {
  return Effect.gen(function* () {
    if (!path.win32.isAbsolute(bin) || !ready(bin)) {
      return yield* Effect.fail(failure(launch.command, "Windows sandbox helper is not available"))
    }
    if (profile.filesystem.allowWrite.some((rule) => rule.kind !== "subtree")) {
      return yield* Effect.fail(failure(launch.command, "Windows sandbox only supports subtree allow rules"))
    }
    const cwd = path.win32.resolve(launch.cwd ?? process.cwd())
    const env = launch.environment ?? {}
    const shell = typeof launch.shell === "string" ? launch.shell : value(env, "COMSPEC") ?? "cmd.exe"
    const source = launch.shell ? shell : launch.command
    const command = resolveExecutable(source, cwd, env, exists)
    if (!command) {
      return yield* Effect.fail(failure(source, "Could not securely resolve the sandboxed executable"))
    }
    const name = path.win32.basename(command).toLowerCase()
    const args = launch.shell
      ? name === "cmd.exe" || name === "cmd"
        ? ["/d", "/s", "/c", launch.command]
        : ["-c", launch.command]
      : launch.args
    const body = request(profile, { ...launch, args, cwd, shell: false }, command)
    if (!body) return yield* Effect.fail(failure(launch.command, "Windows sandbox request exceeds protocol limits"))
    const file = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const dir = mkdtempSync(path.join(tmpdir(), "kilo-sandbox-"))
          const target = path.join(dir, "request.json")
          const fd = openSync(target, "wx", 0o600)
          try {
            writeFileSync(fd, JSON.stringify(body), "utf8")
          } finally {
            closeSync(fd)
          }
          return { dir, target }
        },
        catch: (cause) => failure(launch.command, "Could not create the Windows sandbox request", cause),
      }),
      (item) => Effect.sync(() => rmSync(item.dir, { recursive: true, force: true })),
    )
    return { ...launch, command: bin, args: ["--request", file.target], environment: sanitize(env), shell: false }
  })
}

const target = helper()
const support: Support = !prototype
  ? { available: false, reason: "The Windows sandbox backend is prototype-only" }
  : existsSync(target)
    ? { available: true }
    : { available: false, reason: `${target} is not available` }

export const windows: Backend = {
  support,
  prepare: generate,
}
