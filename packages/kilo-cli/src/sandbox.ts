import { spawnSync } from "node:child_process"
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"

const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
const BWRAP = "/usr/bin/bwrap"
const DEFAULT_DENY_NAMES = [".git"]
const LAUNCHER_DIRECTORY = "kilo2-sandbox-"

export type NetworkMode = "allow" | "deny"

export interface SandboxConfig {
  /** Sandbox hooks are inert unless this is explicitly true. */
  readonly enabled?: boolean | undefined
  /** Filesystem subtree that remains writable by sandboxed shell commands. */
  readonly root?: string | undefined
  /** Additional writable filesystem subtrees. */
  readonly writablePaths?: ReadonlyArray<string> | undefined
  /** Existing paths that must remain read-only even when covered by a writable subtree. */
  readonly denyWritePaths?: ReadonlyArray<string> | undefined
  /**
   * Basenames that cannot be written below a writable subtree. Defaults to `.git` on macOS.
   * Bubblewrap cannot enforce names created after sandbox setup, so Linux defaults to an
   * empty list and rejects non-empty values.
   */
  readonly denyNames?: ReadonlyArray<string> | undefined
  /** Outbound network is denied unless this is explicitly `allow`. */
  readonly network?: NetworkMode | undefined
  /** Optional absolute Bubblewrap path for Linux hosts. */
  readonly bwrapPath?: string | undefined
}

export interface SandboxSupport {
  readonly available: boolean
  readonly backend: "macos" | "linux" | undefined
  readonly reason?: string | undefined
}

export interface ShellInvocation {
  command: string
  cwd: string
  shell: string
  env: Record<string, string | undefined>
}

interface ResolvedConfig {
  readonly root: string
  readonly writablePaths: ReadonlyArray<string>
  readonly denyWritePaths: ReadonlyArray<string>
  readonly denyNames: ReadonlyArray<string>
  readonly network: NetworkMode
  readonly bwrapPath?: string | undefined
}

interface Backend {
  readonly kind: "macos" | "linux"
  readonly executable: string
}

/**
 * Parse the user-facing sandbox object at the host boundary.
 *
 * `sandbox` is deliberately opt-in: an absent object, `false`, or an object
 * without `enabled: true` never changes shell execution. The snake_case names
 * match Kilo's existing configuration vocabulary; camelCase is accepted for
 * the host adapter's typed options.
 */
export function parseSandboxConfig(value: unknown, root?: string): SandboxConfig {
  if (value === undefined || value === null || value === false) return { enabled: false }
  if (value === true) return { enabled: true, root }
  if (!isRecord(value)) throw new Error("Sandbox configuration must be an object or true")

  const supportedKeys = new Set([
    "enabled",
    "root",
    "writablePaths",
    "writable_paths",
    "denyWritePaths",
    "deny_write_paths",
    "denyNames",
    "deny_names",
    "network",
    "bwrapPath",
    "bwrap_path",
  ])
  const unknownKey = Object.keys(value).find((key) => !supportedKeys.has(key))
  if (unknownKey) throw new Error(`Unknown sandbox option: ${unknownKey}`)

  const enabled = value.enabled === undefined ? false : requireBoolean(value.enabled, "sandbox.enabled")
  const writable = value.writablePaths ?? value.writable_paths
  const denied = value.denyWritePaths ?? value.deny_write_paths
  const names = value.denyNames ?? value.deny_names
  const network = value.network === undefined ? undefined : requireNetwork(value.network)
  return {
    enabled,
    root: value.root === undefined ? root : requireString(value.root, "sandbox.root"),
    writablePaths: writable === undefined ? undefined : requireStrings(writable, "sandbox.writable_paths"),
    denyWritePaths: denied === undefined ? undefined : requireStrings(denied, "sandbox.deny_write_paths"),
    denyNames: names === undefined ? undefined : requireStrings(names, "sandbox.deny_names"),
    network,
    bwrapPath:
      value.bwrapPath === undefined && value.bwrap_path === undefined
        ? undefined
        : requireString(value.bwrapPath ?? value.bwrap_path, "sandbox.bwrap_path"),
  }
}

/** Return native support without enabling or mutating anything. */
export function sandboxSupport(
  options: Pick<SandboxConfig, "bwrapPath"> & { readonly platform?: NodeJS.Platform } = {},
): SandboxSupport {
  const backend = selectBackend(options)
  if (!backend) {
    const platform = options.platform ?? process.platform
    if (platform === "darwin") {
      return { available: false, backend: "macos", reason: `${SANDBOX_EXEC} is not available` }
    }
    if (platform === "linux") {
      const candidate = options.bwrapPath ?? process.env.KILO_BWRAP_PATH ?? BWRAP
      return {
        available: false,
        backend: "linux",
        reason: `No usable Bubblewrap executable is available: ${candidate}`,
      }
    }
    return { available: false, backend: undefined, reason: `No sandbox backend is available for ${platform}` }
  }

  const probe = probeBackend(backend)
  return probe === undefined
    ? { available: true, backend: backend.kind }
    : { available: false, backend: backend.kind, reason: probe }
}

/**
 * Build the host-enforced shell hook used by `Shell.Service`.
 *
 * The hook replaces the selected shell with a short-lived launcher whose only
 * job is to enter the OS sandbox and pass the original command as an argv
 * value. The model command is never interpolated into the launcher source.
 * Register this plugin in the host's post phase so it runs after normal shell
 * hooks. ShellTool's optional permission callback still runs afterward; this
 * adapter resolves a relative invocation cwd from the Location directory and
 * confines it before the child process is spawned.
 */
export function createSandboxPlugin(config: SandboxConfig): Plugin {
  const parsed = parseSandboxConfig(config)
  if (!parsed.enabled) {
    return define({
      id: "kilo2.sandbox",
      effect: () => Effect.void,
    })
  }

  const support = sandboxSupport(parsed)
  if (!support.available) throw new Error(`Sandbox is enabled but unavailable: ${support.reason}`)
  // A host normally supplies the selected project root. Validate it before registration so a
  // malformed opt-in cannot silently become an active host with no shell hook.
  if (parsed.root !== undefined) resolveConfig(parsed, parsed.root)
  if (process.platform === "linux" && parsed.denyNames?.length) {
    throw new Error(
      "sandbox.deny_names cannot be enforced for future paths by Bubblewrap; set sandbox.deny_names to [] on Linux",
    )
  }

  return define({
    id: "kilo2.sandbox",
    effect: Effect.fn("KiloSandbox.Plugin")(function* (context) {
      const resolved = resolveConfig(
        { ...parsed, root: parsed.root ?? context.location.directory },
        context.location.directory,
      )
      const backend = requireBackend(resolved)
      const launchers = new Map<string, string>()

      // Shell hooks run before ShellTool's optional permission callback. Keep one launcher per
      // selected shell for this plugin scope so rejected/cancelled invocations cannot leak a
      // temporary directory per attempt. Finalization also covers host shutdown and cancellation.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const filename of launchers.values()) {
            try {
              unlinkSync(filename)
            } catch {}
            try {
              rmdirSync(path.dirname(filename))
            } catch {}
          }
          launchers.clear()
        }),
      )

      yield* context.shell.hook("create.before", (invocation) =>
        Effect.promise(async () => {
          const cwd = path.isAbsolute(invocation.cwd)
            ? invocation.cwd
            : path.resolve(context.location.directory, invocation.cwd)
          const canonicalCwd = canonicalDirectory(cwd, "shell.cwd")
          const shell = canonicalExecutable(invocation.shell, "shell.shell")
          const launcher = launchers.get(shell) ?? createPersistentLauncher(backend, resolved, shell)
          launchers.set(shell, launcher)
          invocation.cwd = canonicalCwd
          invocation.shell = launcher
          invocation.env = { ...invocation.env }
        }).pipe(Effect.orDie),
      )
    }),
  })
}

/**
 * Prepare one shell invocation for native confinement. This is exported so
 * the adapter can be tested against real harmless temporary directories and so
 * hosts that do not use the plugin registry can still use the same boundary.
 */
export async function prepareShell(invocation: ShellInvocation, config: SandboxConfig): Promise<ShellInvocation> {
  const parsed = resolveConfig(config, invocation.cwd)
  const backend = requireBackend(parsed)
  const cwd = canonicalDirectory(invocation.cwd, "shell.cwd")
  const shell = canonicalExecutable(invocation.shell, "shell.shell")
  const launcher = createLauncher(backend, parsed, cwd, shell)
  return {
    ...invocation,
    cwd,
    shell: launcher,
    env: { ...invocation.env },
  }
}

/**
 * Build one argv-preserving launcher that runs any command and its full argv
 * inside the OS sandbox. Unlike the shell hook launcher, the confined
 * executable arrives as the first launcher argument, so commands without
 * arguments work and one launcher can be shared by every caller with the same
 * resolved configuration.
 */
export function createSandboxArgvLauncher(config: SandboxConfig, root: string): { path: string; dispose: () => void } {
  const parsed = parseSandboxConfig(config, root)
  const resolved = resolveConfig(parsed, root)
  const backend = requireBackend(resolved)
  const directory = mkdtempSync(path.join(os.tmpdir(), LAUNCHER_DIRECTORY))
  const filename = path.join(directory, "command")
  try {
    writeFileSync(filename, sandboxArgvLauncherScript(backend, resolved), {
      encoding: "utf8",
      mode: 0o700,
      flag: "wx",
    })
  } catch (cause) {
    try {
      rmdirSync(directory)
    } catch {}
    throw cause
  }
  return {
    path: filename,
    dispose: () => {
      try {
        unlinkSync(filename)
      } catch {}
      try {
        rmdirSync(directory)
      } catch {}
    },
  }
}

/**
 * The launcher script for one backend and resolved configuration. Exported so
 * regression tests can assert both backends' separator handling without a
 * Linux runtime.
 */
export function sandboxArgvLauncherScript(
  backend: { kind: "macos" | "linux"; executable: string },
  config: Parameters<typeof resolveConfig>[0] & { root: string },
): string {
  const resolved = resolveConfig({ ...config, enabled: true }, config.root)
  return backend.kind === "macos" ? macosArgvLauncher(backend, resolved) : linuxArgvLauncher(backend, resolved)
}

function resolveConfig(config: SandboxConfig, fallbackRoot: string): ResolvedConfig {
  if (config.enabled !== true) throw new Error("prepareShell requires sandbox.enabled: true")
  const root = canonicalDirectory(config.root ?? fallbackRoot, "sandbox.root")
  if (path.parse(root).root === root) throw new Error("sandbox.root cannot be the filesystem root")

  const writable = [root, ...(config.writablePaths ?? [])].map((value, index) =>
    canonicalDirectory(value, index === 0 ? "sandbox.root" : "sandbox.writable_paths"),
  )
  const writablePaths = dedupePaths(writable)
  const denyWritePaths = (config.denyWritePaths ?? []).map((value) =>
    canonicalExisting(value, "sandbox.deny_write_paths"),
  )
  const denyNames = config.denyNames ?? (process.platform === "linux" ? [] : DEFAULT_DENY_NAMES)
  if (process.platform === "linux" && denyNames.length > 0) {
    throw new Error(
      "sandbox.deny_names cannot be enforced for future paths by Bubblewrap; set sandbox.deny_names to [] on Linux",
    )
  }
  for (const name of denyNames) {
    if (!name || name === "." || name === ".." || /[\\/"\u0000-\u001f\u007f]/.test(name)) {
      throw new Error(`Invalid sandbox.deny_names entry: ${JSON.stringify(name)}`)
    }
  }
  const network = config.network ?? "deny"
  if (network !== "allow" && network !== "deny") throw new Error(`Invalid sandbox.network: ${String(network)}`)
  const bwrapPath = config.bwrapPath === undefined ? undefined : absolutePath(config.bwrapPath, "sandbox.bwrap_path")
  return { root, writablePaths, denyWritePaths, denyNames, network, bwrapPath }
}

function requireBackend(config: ResolvedConfig): Backend {
  const backend = selectBackend(config)
  if (!backend) {
    const support = sandboxSupport(config)
    throw new Error(`Sandbox backend is unavailable: ${support.reason}`)
  }
  const probe = probeBackend(backend)
  if (probe !== undefined) throw new Error(probe)
  return backend
}

function selectBackend(
  options: Pick<SandboxConfig, "bwrapPath"> & { readonly platform?: NodeJS.Platform },
): Backend | undefined {
  const platform = options.platform ?? process.platform
  if (platform === "darwin") {
    return executableFile(SANDBOX_EXEC) ? { kind: "macos", executable: SANDBOX_EXEC } : undefined
  }
  if (platform !== "linux") return undefined
  const candidate = options.bwrapPath ?? process.env.KILO_BWRAP_PATH ?? BWRAP
  const executable = executableFile(candidate)
  return executable ? { kind: "linux", executable } : undefined
}

function probeBackend(backend: Backend): string | undefined {
  if (backend.kind === "macos") {
    const result = spawnSync(
      backend.executable,
      [
        "-p",
        "(version 1) (deny default) (allow process-exec) (allow process-fork) (allow file-read*)",
        "--",
        "/usr/bin/true",
      ],
      { encoding: "utf8", timeout: 5_000 },
    )
    if (result.status === 0) return undefined
    return `${backend.executable} could not create the macOS sandbox: ${probeDetail(result)}`
  }

  const args = [
    "--unshare-user",
    "--disable-userns",
    "--unshare-pid",
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
    "/usr/bin/true",
  ]
  const result = spawnSync(backend.executable, args, { encoding: "utf8", timeout: 5_000 })
  if (result.status === 0) return undefined
  return `${backend.executable} could not create the Linux sandbox: ${probeDetail(result)}`
}

function probeDetail(result: ReturnType<typeof spawnSync>) {
  if (result.error instanceof Error) return result.error.message
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr?.toString()
  return stderr?.trim() || `exited with status ${result.status}`
}

function createLauncher(backend: Backend, config: ResolvedConfig, cwd: string, shell: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), LAUNCHER_DIRECTORY))
  const filename = path.join(directory, "shell")
  try {
    const source =
      backend.kind === "macos" ? macosLauncher(backend, config, cwd, shell) : linuxLauncher(backend, config, cwd, shell)
    writeFileSync(filename, source, { encoding: "utf8", mode: 0o700, flag: "wx" })
  } catch (cause) {
    try {
      rmdirSync(directory)
    } catch {}
    throw cause
  }
  return filename
}

function createPersistentLauncher(backend: Backend, config: ResolvedConfig, shell: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), LAUNCHER_DIRECTORY))
  const filename = path.join(directory, "shell")
  try {
    const source =
      backend.kind === "macos"
        ? macosPersistentLauncher(backend, config, shell)
        : linuxPersistentLauncher(backend, config, shell)
    writeFileSync(filename, source, { encoding: "utf8", mode: 0o700, flag: "wx" })
  } catch (cause) {
    try {
      rmdirSync(directory)
    } catch {}
    throw cause
  }
  return filename
}

function macosLauncher(backend: Backend, config: ResolvedConfig, cwd: string, shell: string) {
  const profile = macosProfile(config)
  return [
    "#!/bin/sh",
    "if [ \"$#\" -lt 2 ]; then echo 'sandbox launcher requires a shell command' >&2; exit 64; fi",
    `${shellQuote(backend.executable)} -p ${shellQuote(profile)} -- ${shellQuote(shell)} "$@" &`,
    "child=$!",
    'wait "$child"',
    "status=$?",
    'rm -f -- "$0" 2>/dev/null || :',
    'rmdir -- "$(dirname -- "$0")" 2>/dev/null || :',
    'exit "$status"',
    "",
  ].join("\n")
}

function macosPersistentLauncher(backend: Backend, config: ResolvedConfig, shell: string) {
  const profile = macosProfile(config)
  return [
    "#!/bin/sh",
    "if [ \"$#\" -lt 2 ]; then echo 'sandbox launcher requires a shell command' >&2; exit 64; fi",
    `exec ${shellQuote(backend.executable)} -p ${shellQuote(profile)} -- ${shellQuote(shell)} "$@"`,
    "",
  ].join("\n")
}

function macosArgvLauncher(backend: Backend, config: ResolvedConfig) {
  return [
    "#!/bin/sh",
    "if [ \"$#\" -lt 1 ]; then echo 'sandbox launcher requires a command' >&2; exit 64; fi",
    `exec ${shellQuote(backend.executable)} -p ${shellQuote(macosProfile(config))} -- "$@"`,
    "",
  ].join("\n")
}

function linuxLauncher(backend: Backend, config: ResolvedConfig, cwd: string, shell: string) {
  const args = linuxArguments(backend, config, cwd, shell)
  return [
    "#!/bin/sh",
    "if [ \"$#\" -lt 2 ]; then echo 'sandbox launcher requires a shell command' >&2; exit 64; fi",
    `${args.map(shellQuote).join(" ")} "$@" &`,
    "child=$!",
    'wait "$child"',
    "status=$?",
    'rm -f -- "$0" 2>/dev/null || :',
    'rmdir -- "$(dirname -- "$0")" 2>/dev/null || :',
    'exit "$status"',
    "",
  ].join("\n")
}

function linuxPersistentLauncher(backend: Backend, config: ResolvedConfig, shell: string) {
  const args = linuxArguments(backend, config)
  return [
    "#!/bin/sh",
    "if [ \"$#\" -lt 2 ]; then echo 'sandbox launcher requires a shell command' >&2; exit 64; fi",
    `exec ${args.map(shellQuote).join(" ")} ${shellQuote(shell)} "$@"`,
    "",
  ].join("\n")
}

function linuxArgvLauncher(backend: Backend, config: ResolvedConfig) {
  const args = linuxArguments(backend, config)
  return [
    "#!/bin/sh",
    "if [ \"$#\" -lt 1 ]; then echo 'sandbox launcher requires a command' >&2; exit 64; fi",
    // linuxArguments already ends with the `--` command separator; the launcher arguments follow.
    `exec ${args.map(shellQuote).join(" ")} "$@"`,
    "",
  ].join("\n")
}

function macosProfile(config: ResolvedConfig) {
  const allow = config.writablePaths.map((value) => `(subpath "${seatbeltEscape(value)}")`)
  const denied = [
    ...config.denyWritePaths.map((value) => `(require-not (subpath "${seatbeltEscape(value)}"))`),
    ...config.denyNames.map((value) => `(require-not (regex #"(^|/)${regexEscape(value)}(/|$)"))`),
  ]
  const write = allow.length
    ? [
        "(allow file-write*",
        "  (require-all",
        `    (require-any ${allow.join(" ")})`,
        ...denied.map((value) => `    ${value}`),
        "  )",
        ")",
      ].join("\n")
    : ""
  const network = config.network === "allow" ? "(allow network-outbound)" : ""
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    '(allow file-write-data (require-all (path "/dev/null") (vnode-type CHARACTER-DEVICE)))',
    "(allow sysctl-read)",
    "(allow file-read*)",
    network,
    write,
    "",
  ]
    .filter(Boolean)
    .join("\n")
}

function linuxArguments(backend: Backend, config: ResolvedConfig, cwd?: string, shell?: string) {
  const mounts = mountpoints()
  validateWritable(config.writablePaths, backend.executable, mounts)
  const args = [
    backend.executable,
    "--unshare-user",
    "--disable-userns",
    "--unshare-pid",
    ...(config.network === "deny" ? ["--unshare-net"] : []),
    "--die-with-parent",
    "--new-session",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
  ]
  for (const value of config.writablePaths) args.push("--bind", value, value)
  for (const value of config.denyWritePaths) args.push("--ro-bind", value, value)
  args.push("--proc", "/proc")
  if (cwd) args.push("--chdir", cwd)
  args.push("--")
  if (shell) args.push(shell)
  return args
}

function mountpoints() {
  if (process.platform !== "linux") return []
  const content = readFileSync("/proc/self/mountinfo", "utf8")
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" - ")
      const field = line.slice(0, separator === -1 ? line.length : separator).split(" ")[4]
      if (!field) throw new Error("Could not parse /proc/self/mountinfo")
      return field.replace(/\\([0-7]{3})/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 8)))
    })
}

function validateWritable(paths: ReadonlyArray<string>, executable: string, mounts: ReadonlyArray<string>) {
  if (paths.some((root) => beneath(root, executable))) {
    throw new Error(`Bubblewrap executable is writable by the sandbox profile: ${executable}`)
  }
  for (const root of paths) {
    const nested = mounts.find((mount) => mount !== root && beneath(root, mount))
    if (nested) throw new Error(`Writable root contains a nested mount point: ${nested}`)
  }
}

function beneath(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function canonicalDirectory(value: string, label: string) {
  const absolute = absolutePath(value, label)
  const stat = lstatSync(absolute, { throwIfNoEntry: false })
  if (!stat) throw new Error(`${label} does not exist: ${absolute}`)
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${absolute}`)
  return realpathSync.native(absolute)
}

function canonicalExisting(value: string, label: string) {
  const absolute = absolutePath(value, label)
  if (!existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`)
  return realpathSync.native(absolute)
}

function canonicalExecutable(value: string, label: string) {
  const absolute = absolutePath(value, label)
  const executable = realpathSync.native(absolute)
  const stat = statSync(executable, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new Error(`${label} is not a regular file: ${absolute}`)
  accessSync(executable, constants.X_OK)
  return executable
}

function executableFile(value: string) {
  if (!path.isAbsolute(value)) return undefined
  try {
    const target = realpathSync.native(value)
    const stat = statSync(target)
    if (!stat.isFile() || (stat.mode & 0o6000) !== 0) return undefined
    accessSync(target, constants.X_OK)
    return target
  } catch {
    return undefined
  }
}

function absolutePath(value: string, label: string) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} contains a control character`)
  return path.resolve(value)
}

function dedupePaths(values: ReadonlyArray<string>) {
  return [...new Set(values)]
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function seatbeltEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  return value
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`)
  return value
}

function requireStrings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${label} must be an array of strings`)
  return value
}

function requireNetwork(value: unknown): NetworkMode {
  if (value !== "allow" && value !== "deny") throw new Error("sandbox.network must be `allow` or `deny`")
  return value
}
