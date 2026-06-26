import { Effect, PlatformError, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { bubblewrap } from "./bubblewrap"
import { current } from "./context"
import { assertProcessNetwork, networkEnvironment } from "./network"
import type { Profile } from "./profile"
import { seatbelt } from "./seatbelt"

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
  readonly prepare: (
    profile: Profile,
    launch: Launch,
  ) => Effect.Effect<Launch, PlatformError.PlatformError, Scope.Scope>
}

function unavailable(reason: string): Backend {
  return {
    support: () => ({ available: false, reason }),
    prepare: (_profile, launch) => Effect.succeed(launch),
  }
}

function select(): Backend {
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

const backend = select()

function environment(profile: Profile, launch: Launch) {
  const source = { ...launch.environment, ...profile.environment.set }
  const denied = new Set(profile.environment.deny)
  const entries = Object.entries(source).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !denied.has(entry[0]),
  )
  return networkEnvironment(profile, Object.fromEntries(entries))
}

export function prepare(launch: Launch) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return launch
    const next = { ...launch, environment: environment(profile, launch) }
    yield* assertProcessNetwork(profile, launch.command)
    if (!backend.support().available) return next
    return yield* backend.prepare(profile, next)
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
    const next = { ...launch, environment: environment(profile, launch) }
    yield* assertProcessNetwork(profile, launch.command)
    const support = backend.support(profile.network)
    if (!support.available) return yield* Effect.fail(unsupported(launch.command, "confine", support))
    return yield* backend.prepare(profile, next)
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
      args: command.args,
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
  return backend.support(network)
}
