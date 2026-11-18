import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Effect, PlatformError } from "effect"
import type { Backend, Launch, Support } from "./backend"
import { binary, environment, root, support, version } from "./nono-binary"
import { aliases, load, type Credential } from "./nono-credentials"
import { generate, restoreEnvironment, type NonoProfile } from "./nono-profile"
import { canonicalize } from "./path"
import { shellCommand } from "./shell"

export function wrap(input: {
  readonly binary: string
  readonly profile: string
  readonly launch: Launch
  readonly environment: Record<string, string | undefined>
  readonly allowCwd: boolean
}): Launch {
  const { command, args } = shellCommand(input.launch)
  return {
    command: input.binary,
    args: [
      "--silent",
      "run",
      "--no-audit",
      ...(input.allowCwd ? ["--allow-cwd"] : []),
      "--profile",
      input.profile,
      "--",
      command,
      ...args,
    ],
    cwd: input.launch.cwd,
    environment: input.environment,
    shell: false,
  }
}

/** Profiles are content-addressed, so a file no launch can still be reading is garbage after a while. */
const retention = 7 * 24 * 60 * 60 * 1000

/** Best effort: a concurrent launch may remove an entry first, and cleanup must never fail the launch. */
function sweep(dir: string, keep: string) {
  const cutoff = Date.now() - retention
  const current = path.basename(keep)
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === current || !entry.name.endsWith(".json")) continue
      const file = path.join(dir, entry.name)
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true })
    }
  } catch {
    // A stale profile that cannot be listed or removed is not a reason to refuse the command.
  }
}

function write(profile: NonoProfile) {
  const text = JSON.stringify(profile, null, 2)
  const dir = path.join(root(), "profiles")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, createHash("sha256").update(text).digest("hex").slice(0, 32) + ".json")
  sweep(dir, file)
  if (existsSync(file)) return file
  // Renamed into place: an interrupted or concurrent write would otherwise poison every later launch.
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, text, { mode: 0o600 })
  renameSync(temporary, file)
  return file
}

function secrets(launch: Launch, routes: ReadonlyArray<Credential>) {
  const env = launch.environment ?? {}
  return routes.flatMap((route) => {
    const value = env[route.envVar]
    const named = aliases(route.envVar).filter((alias) => alias !== route.envVar)
    if (value === undefined || value.length === 0) return named
    return [
      ...named,
      ...Object.entries(env)
        .filter(([key, candidate]) => key !== route.envVar && candidate === value)
        .map(([key]) => key),
    ]
  })
}

function database() {
  const file = process.env.OPENCODE_DB
  if (!file) return []
  return [file, `${file}-wal`, `${file}-shm`]
}

let loaded: { readonly key: string; readonly value: ReadonlyArray<Credential> } | undefined

/** The credential file changes rarely, so re-read it only when its path, size or mtime changes. */
function routes() {
  const file = process.env.KILO_NONO_CREDENTIALS
  if (!file) return []
  const info = existsSync(file) ? statSync(file) : undefined
  const key = `${file}|${info?.mtimeMs ?? 0}|${info?.size ?? 0}`
  if (loaded?.key !== key) loaded = { key, value: load(file) }
  return loaded.value
}

const backend: Backend = {
  support: (): Support => support(),
  mediatesNetwork: true,
  prepare: (profile, launch) =>
    Effect.gen(function* () {
      // The profile is canonicalized by run(); the cwd must be too, or a symlinked spelling changes the decision.
      const cwd = launch.cwd === undefined ? undefined : yield* canonicalize(launch.cwd)
      return yield* Effect.try({
        try: () => {
          const file = binary()
          if (!file) throw new Error(`nono ${version} is not staged and KILO_NONO_PATH is not set`)
          const status = support()
          if (!status.available) throw new Error(status.reason)
          const configured = routes()
          // Mirrors the generator's emission rule: proxy mode with an empty allowlist emits no route.
          const routed = profile.network.mode === "proxy" && profile.network.allowedHosts.length > 0
          const active = routed ? configured : []
          for (const route of active) {
            const value = launch.environment?.[route.envVar]
            if (value === undefined || value.length === 0) {
              throw new Error(`Credential ${route.name} needs ${route.envVar}, which is not set`)
            }
          }
          // A route that is not emitted cannot mint a placeholder, so its real value must not reach the child.
          const masked = new Set(secrets(launch, configured))
          for (const route of configured) if (!active.includes(route)) masked.add(route.envVar)
          const generated = generate(profile, {
            credentials: active,
            cwd,
            denies: database(),
            restore: restoreEnvironment(launch.environment ?? {}),
            secret: [...masked],
          })
          const profileFile = write(generated)
          return wrap({
            binary: file,
            profile: profileFile,
            launch,
            environment: environment(launch.environment ?? {}, launch.cwd ?? process.cwd()),
            allowCwd: generated.workdir.access !== "none",
          })
        },
        catch: (cause) =>
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "Sandbox",
            method: "prepare",
            pathOrDescriptor: launch.command,
            description: cause instanceof Error ? cause.message : "Could not prepare the nono sandbox",
            cause,
          }),
      })
    }),
}

export const nono = backend
