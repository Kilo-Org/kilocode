import { Effect, PlatformError, Redacted, Scope } from "effect"
import { ChildProcess } from "effect/process"
import { bubblewrap } from "./bubblewrap"
import { current } from "./context"
import { assertProcessNetwork, networkEnvironment } from "./network"
import { nono } from "./nono"
import type { Profile } from "./profile"
import { seatbelt } from "./seatbelt"
import { currentProxy, type ProxyRuntime } from "./proxy"

export interface Launch {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string | undefined
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined
  readonly shell?: boolean | string | undefined
}

export interface Support {
  readonly available: boolean
  readonly reason?: string | undefined
}

export interface Backend {
  readonly support: (network?: Profile["network"]) => Support
  /** The backend mediates egress itself, so Kilo's proxy must not reach the child's environment. */
  readonly mediatesNetwork?: boolean
  readonly prepare: (
    profile: Profile,
    launch: Launch,
    proxy?: ProxyRuntime,
  ) => Effect.Effect<Launch, PlatformError.PlatformError, Scope.Scope>
}

function unavailable(reason: string): Backend {
  return {
    support: () => ({ available: false, reason }),
    prepare: (_profile, launch) => Effect.succeed(launch),
  }
}

function select(): Backend {
  // POC only: requires the dev launcher, which sets KILO_V2_DEV, so a release never selects it.
  if (process.env.KILO_V2_DEV === "1" && process.env.KILO_SANDBOX_BACKEND === "nono") return nono
  switch (process.platform) {
    case "darwin":
      return seatbelt
    case "linux":
      return bubblewrap
    case "win32":
      return unavailable("The Windows sandbox backend is not available")
    default:
      return unavailable("No sandbox backend is available for this operating system")
  }
}

let selected: { readonly key: string; readonly value: Backend } | undefined

/** Resolves the backend, re-reading the POC switch so a process can flip it before its first launch. */
function preferred() {
  const key = `${process.env.KILO_V2_DEV ?? ""}|${process.env.KILO_SANDBOX_BACKEND ?? ""}`
  if (selected?.key !== key) selected = { key, value: select() }
  return selected.value
}

function environment(profile: Profile, launch: Launch, proxy?: ProxyRuntime) {
  const source = { ...launch.environment, ...profile.environment.set }
  const denied = new Set(profile.environment.deny)
  const entries = Object.entries(source).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !denied.has(entry[0]),
  )
  return networkEnvironment(profile, Object.fromEntries(entries), preferred().mediatesNetwork ? undefined : proxy)
}

export function prepare(launch: Launch) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return launch
    const proxy = yield* currentProxy
    const next = { ...launch, environment: environment(profile, launch, proxy) }
    yield* assertProcessNetwork(profile, launch.command)
    const target = preferred()
    const support = target.support(profile.network)
    if (!support.available) return yield* Effect.fail(unsupported(launch.command, "prepare", support))
    return yield* target.prepare(profile, next, proxy)
  })
}

function unsupported(command: string, method: string, support: Support) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method,
    pathOrDescriptor: command,
    description: support.reason ?? "The process sandbox backend is unavailable",
  })
}

export function confine(profile: Profile, launch: Launch) {
  return Effect.gen(function* () {
    const proxy = yield* currentProxy
    const next = { ...launch, environment: environment(profile, launch, proxy) }
    yield* assertProcessNetwork(profile, launch.command)
    const target = preferred()
    const support = target.support(profile.network)
    if (!support.available) return yield* Effect.fail(unsupported(launch.command, "confine", support))
    return yield* target.prepare(profile, next, proxy)
  })
}

export function prepareCommand(
  command: ChildProcess.StandardCommand,
  cwd: string | undefined,
  env: Readonly<Record<string, string | undefined>> | undefined,
) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return command
    const launch = yield* confine(profile, {
      command: command.command,
      args: command.args.map(plain),
      cwd,
      environment: env,
      shell: command.options.shell,
    })
    return ChildProcess.make(launch.command, launch.args, {
      ...command.options,
      cwd: launch.cwd,
      env: launch.environment,
      extendEnv: false,
      shell: false,
    })
  })
}

export function backendSupport(network?: Profile["network"]) {
  return preferred().support(network)
}

// A command can carry redacted words; the confined launcher needs their plain text.
function plain(word: string | Redacted.Redacted<string>) {
  return typeof word === "string" ? word : Redacted.value(word)
}
