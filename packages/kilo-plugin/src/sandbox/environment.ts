import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { batchMutations, decorateFileSystem, enabled, ensureDirectory, prepareCommand } from "@kilocode/sandbox"
import { Environment } from "@opencode/core/environment/index"
import { Context, Effect, FileSystem, Layer, PlatformError } from "effect"
import { ChildProcess } from "effect/process"
import { make } from "effect/process/ChildProcessSpawner"

/**
 * The environment variable that ties a shell command to the sandboxed tool call that started it. Shell commands spawn
 * on a fiber of the Shell service, not on the tool call's fiber, so the sandbox profile cannot reach the spawn
 * through the fiber context. The `shell` `create.before` hook runs on the tool call's fiber: it registers that
 * fiber's context under a one-time token, and the spawner prepares the command with it.
 */
export const marker = "KILO_SANDBOX_LAUNCH"

const launches = new Map<string, Context.Context<never>>()

/** Registers the current fiber's sandbox context for one spawn. Returns the token for {@link marker}. */
export const register = Effect.gen(function* () {
  const token = randomUUID()
  launches.set(token, yield* Effect.context<never>())
  return token
})

export function release(token: string) {
  launches.delete(token)
}

function environment(options: ChildProcess.CommandOptions) {
  return options.extendEnv ? { ...process.env, ...options.env } : options.env
}

function denied(command: string, description: string) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method: "spawn",
    pathOrDescriptor: command,
    description,
  })
}

function prepare(command: ChildProcess.Command) {
  return Effect.gen(function* () {
    if (command._tag !== "StandardCommand") {
      if (yield* enabled) return yield* Effect.fail(denied("pipeline", "Sandbox cannot confine a piped command"))
      return command
    }
    const env = environment(command.options)
    const token = env?.[marker]
    if (token === undefined) return yield* prepareCommand(command, command.options.cwd, env)
    const context = launches.get(token)
    launches.delete(token)
    if (!context) return yield* Effect.fail(denied(command.command, "Unknown sandbox launch"))
    const { [marker]: _, ...rest } = env ?? {}
    return yield* prepareCommand(
      ChildProcess.make(command.command, command.args, { ...command.options, env: rest, extendEnv: false }),
      command.options.cwd,
      rest,
    ).pipe(Effect.provideContext(context))
  })
}

const node = Effect.promise(() => import("@effect/platform-node"))

function failed(path: string) {
  return (cause: unknown) => new Environment.Failed({ path, cause })
}

/** A spawner that prepares every command in the current fiber's sandbox profile before the base spawner runs it. */
export function confine(base: Pick<Environment.Interface["spawner"], "spawn">) {
  return make((command) => prepare(command).pipe(Effect.flatMap((next) => base.spawn(next))))
}


function decorate(base: Environment.Interface): Environment.Interface {
  const spawner = confine(base.spawner)
  // Writes from a sandboxed tool call go through the sandbox mutation worker, which runs inside the profile. The Node
  // file system loads on the first confined write: importing it at module load costs every host start.
  const confined = <A, E>(
    path: string,
    fallback: Effect.Effect<A, E>,
    mutation: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError.PlatformError>,
  ) =>
    Effect.flatMap(enabled, (active): Effect.Effect<A, E | Environment.Failed> => {
      if (!active) return fallback
      return Effect.flatMap(node, ({ NodeFileSystem }) =>
        Effect.gen(function* () {
          const fs = decorateFileSystem(yield* FileSystem.FileSystem)
          return yield* batchMutations(mutation(fs))
        }).pipe(Effect.provide(NodeFileSystem.layer), Effect.mapError(failed(path))),
      )
    })
  const files: Environment.Files = {
    ...base.files,
    write: (path, bytes) =>
      confined(path, base.files.write(path, bytes), (fs) =>
        ensureDirectory(fs, dirname(path)).pipe(Effect.andThen(fs.writeFile(path, bytes))),
      ),
    remove: (path) =>
      confined(path, base.files.remove(path), (fs) => fs.remove(path, { recursive: true, force: true })),
    mkdir: (path) => confined(path, base.files.mkdir(path), (fs) => ensureDirectory(fs, path)),
    move: (from, to) =>
      Effect.flatMap(enabled, (active) => {
        if (!active) return base.files.move(from, to)
        return Effect.gen(function* () {
          yield* base.files.stat(from)
          const target = yield* base.files.stat(to).pipe(
            Effect.map((info) => (info.type === "directory" ? `${to}/${from.split("/").pop()}` : to)),
            Effect.catchTag("Environment.NotFound", () => Effect.succeed(to)),
          )
          yield* confined(from, Effect.void, (fs) => fs.rename(from, target))
        })
      }),
  }
  return { files, spawner }
}

/** Decorates the Location's Environment so that sandboxed tool calls spawn and write inside the sandbox. */
export const layer = <E, R>(base: Layer.Layer<Environment.Service, E, R>) =>
  Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      return decorate(yield* Environment.Service)
    }),
  ).pipe(Layer.provide(base))
