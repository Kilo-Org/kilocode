import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { dirname, resolve } from "node:path"
import type { Writable } from "node:stream"
import { finished } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { Context, Effect, PlatformError } from "effect"
import { confine } from "./backend"
import { isResponse, type BatchOperation, type Failure, type Operation, type Request } from "./mutation-protocol"
import type { Profile } from "./profile"

declare const KILO_SANDBOX_MUTATION_WORKER_PATH: string

function worker() {
  if (typeof KILO_SANDBOX_MUTATION_WORKER_PATH === "undefined") {
    return { path: fileURLToPath(new URL("./kilo-sandbox-mutation-worker.ts", import.meta.url)), environment: {} }
  }
  const path = KILO_SANDBOX_MUTATION_WORKER_PATH.startsWith(".")
    ? fileURLToPath(new URL(KILO_SANDBOX_MUTATION_WORKER_PATH, import.meta.url))
    : resolve(dirname(process.execPath), KILO_SANDBOX_MUTATION_WORKER_PATH)
  return { path, environment: { BUN_BE_BUN: "1" } }
}

function tag(code: string | undefined): PlatformError.SystemErrorTag {
  switch (code) {
    case "EEXIST":
      return "AlreadyExists"
    case "EBADF":
    case "EISDIR":
    case "ELOOP":
    case "ENOTDIR":
      return "BadResource"
    case "EBUSY":
      return "Busy"
    case "EINVAL":
      return "InvalidData"
    case "ENOENT":
      return "NotFound"
    case "EACCES":
    case "EPERM":
      return "PermissionDenied"
    case "ETIMEDOUT":
      return "TimedOut"
    case "EAGAIN":
      return "WouldBlock"
    default:
      return "Unknown"
  }
}

function failure(method: string, path: string, error: Failure) {
  const cause = Object.assign(new Error(error.message), {
    name: error.name,
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    path: error.path,
    dest: error.dest,
  })
  if (!error.code) {
    return PlatformError.badArgument({ module: "FileSystem", method, description: error.message, cause })
  }
  return PlatformError.systemError({
    _tag: tag(error.code),
    module: "FileSystem",
    method,
    pathOrDescriptor: error.path ?? path,
    syscall: error.syscall,
    description: error.message,
    cause,
  })
}

function infrastructure(path: string, description: string, cause?: unknown) {
  return PlatformError.systemError({
    _tag: "Unknown",
    module: "Sandbox",
    method: "mutate",
    pathOrDescriptor: path,
    description,
    cause,
  })
}

function target(request: Request): string {
  if (request.op === "batch") return target(request.operations[0])
  if ("path" in request) return request.path
  if ("to" in request) return request.to
  return request.options?.directory ?? process.cwd()
}

function output(stream: NodeJS.ReadableStream) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on("end", () => resolve(Buffer.concat(chunks)))
    stream.on("error", reject)
  })
}

function send(stream: Writable, data: string) {
  const done = finished(stream)
  stream.end(data)
  return done
}

export async function settle(
  input: Promise<void>,
  stdout: Promise<Buffer>,
  stderr: Promise<Buffer>,
  exited: Promise<number | null>,
  path: string,
) {
  const delivery = input.then(
    () => ({ ok: true as const }),
    (cause: unknown) => ({ ok: false as const, cause }),
  )
  const [sent, out, err, code] = await Promise.all([delivery, stdout, stderr, exited])
  if (code !== 0) {
    throw infrastructure(
      path,
      err.toString("utf8").trim() || `Filesystem worker exited with code ${code}`,
      sent.ok ? undefined : sent.cause,
    )
  }
  if (!sent.ok) throw sent.cause
  return out
}

async function exchange(proc: ChildProcessWithoutNullStreams, data: string, path: string) {
  const exited = new Promise<number | null>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", resolve)
  })
  return settle(send(proc.stdin, data), output(proc.stdout), output(proc.stderr), exited, path)
}

export type Runner = (
  profile: Profile,
  request: Request,
) => Effect.Effect<string | undefined, PlatformError.PlatformError>

export const mutate: Runner = (profile, request) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = worker()
      const launch = yield* confine(profile, {
        command: process.execPath,
        args: [child.path],
        cwd: process.cwd(),
        environment: process.env,
      })
      const path = target(request)
      const result = yield* Effect.tryPromise({
        try: async (signal) => {
          const proc = spawn(launch.command, launch.args, {
            cwd: launch.cwd,
            env: { ...launch.environment, ...child.environment },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: process.platform === "win32",
          })
          const abort = () => proc.kill()
          signal.addEventListener("abort", abort, { once: true })
          const out = await exchange(proc, JSON.stringify(request), path).finally(() =>
            signal.removeEventListener("abort", abort),
          )
          try {
            const response: unknown = JSON.parse(out.toString("utf8"))
            if (isResponse(response)) return response
            throw new TypeError("Invalid filesystem worker response")
          } catch (cause) {
            throw infrastructure(path, "Filesystem worker returned an invalid response", cause)
          }
        },
        catch: (cause) =>
          cause instanceof PlatformError.PlatformError
            ? cause
            : infrastructure(path, cause instanceof Error ? cause.message : String(cause), cause),
      })
      if (!result.ok) return yield* Effect.fail(failure(result.error.operation ?? request.op, path, result.error))
      return result.value
    }),
  )

const CurrentRunner = Context.Reference<Runner>("@kilocode/sandbox/CurrentMutationRunner", {
  defaultValue: () => mutate,
})

export const currentRunner: Effect.Effect<Runner> = Effect.gen(function* () {
  return yield* CurrentRunner
})

export function withRunner<A, E, R>(runner: Runner, effect: Effect.Effect<A, E, R>) {
  return effect.pipe(Effect.provideService(CurrentRunner, runner))
}

function returnsValue(
  request: Request,
): request is Extract<Operation, { readonly op: "makeTempDirectory" | "makeTempFile" }> {
  return request.op === "makeTempDirectory" || request.op === "makeTempFile"
}

export function batchMutations<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const upstream = yield* currentRunner
    const state: { closed: boolean; profile?: Profile; operations: BatchOperation[] } = {
      closed: false,
      operations: [],
    }
    const flush = () =>
      Effect.gen(function* () {
        const profile = state.profile
        if (!profile || state.operations.length === 0) return
        const operations = state.operations.splice(0)
        state.profile = undefined
        yield* upstream(profile, { op: "batch", operations })
      })
    const collect: Runner = (profile, request) =>
      Effect.gen(function* () {
        if (state.closed) return yield* upstream(profile, request)
        if (state.profile && state.profile !== profile) yield* flush()
        if (returnsValue(request)) {
          yield* flush()
          return yield* upstream(profile, request)
        }
        state.profile = profile
        if (request.op === "batch") state.operations.push(...request.operations)
        else state.operations.push(request)
        return undefined
      })
    const close = Effect.sync(() => (state.closed = true)).pipe(Effect.andThen(flush()))
    return yield* withRunner(collect, effect).pipe(Effect.onExit(() => close))
  })
}
