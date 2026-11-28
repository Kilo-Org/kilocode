import type * as Arr from "effect/Array"
import { NodeFileSystem, NodeSink, NodeStream } from "@effect/platform-node"
import * as NodePath from "@effect/platform-node/NodePath"
import { prepareCommand as prepareSandbox } from "@kilocode/sandbox" // kilocode_change
import { release as releaseStdio, tap as tapStdio, tapped } from "./kilocode/stdio-tap" // kilocode_change - Bun drops buffered stdio on close
import * as SpawnExit from "./kilocode/spawn-exit" // kilocode_change
import * as SpawnValidation from "./kilocode/spawn-validation" // kilocode_change
import { settle } from "./kilocode/exit-code" // kilocode_change - settle signal termination as 128 + signum
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId,
} from "effect/unstable/process/ChildProcessSpawner"
import * as NodeChildProcess from "node:child_process"
import { PassThrough } from "node:stream"
import launch from "cross-spawn"
import { makeGlobalNode } from "./effect/app-node"
import { filesystem, path } from "./effect/app-node-platform"

const toError = (err: unknown): Error => (err instanceof globalThis.Error ? err : new globalThis.Error(String(err)))

const toTag = (err: NodeJS.ErrnoException): PlatformError.SystemErrorTag => {
  switch (err.code) {
    case "ENOENT":
      return "NotFound"
    case "EACCES":
      return "PermissionDenied"
    case "EEXIST":
      return "AlreadyExists"
    case "EISDIR":
      return "BadResource"
    case "ENOTDIR":
      return "BadResource"
    case "EBUSY":
      return "Busy"
    case "ELOOP":
      return "BadResource"
    default:
      return "Unknown"
  }
}

const flatten = (command: ChildProcess.Command) => {
  const commands: Array<ChildProcess.StandardCommand> = []
  const opts: Array<ChildProcess.PipeOptions> = []

  const walk = (cmd: ChildProcess.Command): void => {
    switch (cmd._tag) {
      case "StandardCommand":
        commands.push(cmd)
        return
      case "PipedCommand":
        walk(cmd.left)
        opts.push(cmd.options)
        walk(cmd.right)
        return
    }
  }

  walk(command)
  if (commands.length === 0) throw new Error("flatten produced empty commands array")
  const [head, ...tail] = commands
  return {
    commands: [head, ...tail] as Arr.NonEmptyReadonlyArray<ChildProcess.StandardCommand>,
    opts,
  }
}

const toPlatformError = (
  method: string,
  err: NodeJS.ErrnoException,
  command: ChildProcess.Command,
): PlatformError.PlatformError => {
  const cmd = flatten(command)
    .commands.map((x) => `${x.command} ${x.args.join(" ")}`)
    .join(" | ")
  return PlatformError.systemError({
    _tag: toTag(err),
    module: "ChildProcess",
    method,
    pathOrDescriptor: cmd,
    syscall: err.syscall,
    cause: err,
  })
}

// kilocode_change start - retain foreground exit independently of ordinary close settlement
type Status = readonly [code: number | null, signal: NodeJS.Signals | null]
type ExitSignal = Deferred.Deferred<Status>
type Spawned = readonly [NodeChildProcess.ChildProcess, ExitSignal, ExitSignal]
// kilocode_change end

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const cwd = Effect.fnUntraced(function* (opts: ChildProcess.CommandOptions) {
    if (Predicate.isUndefined(opts.cwd)) return undefined
    yield* fs.access(opts.cwd)
    return path.resolve(opts.cwd)
  })

  const env = (opts: ChildProcess.CommandOptions) =>
    opts.extendEnv ? { ...globalThis.process.env, ...opts.env } : opts.env

  const input = (x: ChildProcess.CommandInput | undefined): NodeChildProcess.IOType | undefined =>
    Stream.isStream(x) ? "pipe" : x

  const output = (x: ChildProcess.CommandOutput | undefined): NodeChildProcess.IOType | undefined =>
    Sink.isSink(x) ? "pipe" : x

  const stdin = (opts: ChildProcess.CommandOptions): ChildProcess.StdinConfig => {
    const cfg: ChildProcess.StdinConfig = { stream: "pipe", encoding: "utf-8", endOnDone: true }
    if (Predicate.isUndefined(opts.stdin)) return cfg
    if (typeof opts.stdin === "string") return { ...cfg, stream: opts.stdin }
    if (Stream.isStream(opts.stdin)) return { ...cfg, stream: opts.stdin }
    return {
      stream: opts.stdin.stream,
      encoding: opts.stdin.encoding ?? cfg.encoding,
      endOnDone: opts.stdin.endOnDone ?? cfg.endOnDone,
    }
  }

  const stdio = (opts: ChildProcess.CommandOptions, key: "stdout" | "stderr"): ChildProcess.StdoutConfig => {
    const cfg = opts[key]
    if (Predicate.isUndefined(cfg)) return { stream: "pipe" }
    if (typeof cfg === "string") return { stream: cfg }
    if (Sink.isSink(cfg)) return { stream: cfg }
    return { stream: cfg.stream }
  }

  const fds = (opts: ChildProcess.CommandOptions) => {
    if (Predicate.isUndefined(opts.additionalFds)) return []
    return Object.entries(opts.additionalFds)
      .flatMap(([name, config]) => {
        const fd = ChildProcess.parseFdName(name)
        return Predicate.isUndefined(fd) ? [] : [{ fd, config }]
      })
      .toSorted((a, b) => a.fd - b.fd)
  }

  const stdios = (
    sin: ChildProcess.StdinConfig,
    sout: ChildProcess.StdoutConfig,
    serr: ChildProcess.StderrConfig,
    extra: ReadonlyArray<{ fd: number; config: ChildProcess.AdditionalFdConfig }>,
  ): NodeChildProcess.StdioOptions => {
    const pipe = (x: NodeChildProcess.IOType | undefined) =>
      process.platform === "win32" && x === "pipe" ? "overlapped" : x
    const arr: Array<NodeChildProcess.IOType | undefined> = [
      pipe(input(sin.stream)),
      pipe(output(sout.stream)),
      pipe(output(serr.stream)),
    ]
    if (extra.length === 0) return arr as NodeChildProcess.StdioOptions
    const max = extra.reduce((acc, x) => Math.max(acc, x.fd), 2)
    for (let i = 3; i <= max; i++) arr[i] = "ignore"
    for (const x of extra) arr[x.fd] = pipe("pipe")
    return arr as NodeChildProcess.StdioOptions
  }

  const setupFds = Effect.fnUntraced(function* (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    extra: ReadonlyArray<{ fd: number; config: ChildProcess.AdditionalFdConfig }>,
  ) {
    if (extra.length === 0) {
      return {
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }
    }

    const ins = new Map<number, Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError>>()
    const outs = new Map<number, Stream.Stream<Uint8Array, PlatformError.PlatformError>>()

    for (const x of extra) {
      const node = proc.stdio[x.fd]
      switch (x.config.type) {
        case "input": {
          let sink: Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError> = Sink.drain
          if (node && "write" in node) {
            sink = NodeSink.fromWritable({
              evaluate: () => node,
              onError: (err) => toPlatformError(`fromWritable(fd${x.fd})`, toError(err), command),
              endOnDone: true,
            })
          }
          if (x.config.stream) yield* Effect.forkScoped(Stream.run(x.config.stream, sink))
          ins.set(x.fd, sink)
          break
        }
        case "output": {
          let stream: Stream.Stream<Uint8Array, PlatformError.PlatformError> = Stream.empty
          if (node && "read" in node) {
            const tap = new PassThrough()
            node.on("error", (err) => tap.destroy(toError(err)))
            node.pipe(tap)
            stream = NodeStream.fromReadable({
              evaluate: () => tap,
              onError: (err) => toPlatformError(`fromReadable(fd${x.fd})`, toError(err), command),
            })
          }
          if (x.config.sink) stream = Stream.transduce(stream, x.config.sink)
          outs.set(x.fd, stream)
          break
        }
      }
    }

    return {
      getInputFd: (fd: number) => ins.get(fd) ?? Sink.drain,
      getOutputFd: (fd: number) => outs.get(fd) ?? Stream.empty,
    }
  })

  const setupStdin = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    cfg: ChildProcess.StdinConfig,
  ) =>
    Effect.suspend(() => {
      let sink: Sink.Sink<void, unknown, never, PlatformError.PlatformError> = Sink.drain
      if (Predicate.isNotNull(proc.stdin)) {
        sink = NodeSink.fromWritable({
          evaluate: () => proc.stdin!,
          onError: (err) => toPlatformError("fromWritable(stdin)", toError(err), command),
          endOnDone: cfg.endOnDone,
          encoding: cfg.encoding,
        })
      }
      if (Stream.isStream(cfg.stream)) return Effect.as(Effect.forkScoped(Stream.run(cfg.stream, sink)), sink)
      return Effect.succeed(sink)
    })

  const setupOutput = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    out: ChildProcess.StdoutConfig,
    err: ChildProcess.StderrConfig,
  ) => {
    let stdout = proc.stdout
      ? NodeStream.fromReadable({
          evaluate: () => tapped(proc, "stdout"), // kilocode_change - read the spawn-time tap
          onError: (cause) => toPlatformError("fromReadable(stdout)", toError(cause), command),
        })
      : Stream.empty
    let stderr = proc.stderr
      ? NodeStream.fromReadable({
          evaluate: () => tapped(proc, "stderr"), // kilocode_change - read the spawn-time tap
          onError: (cause) => toPlatformError("fromReadable(stderr)", toError(cause), command),
        })
      : Stream.empty

    if (Sink.isSink(out.stream)) stdout = Stream.transduce(stdout, out.stream)
    if (Sink.isSink(err.stream)) stderr = Stream.transduce(stderr, err.stream)

    return { stdout, stderr, all: Stream.merge(stdout, stderr) }
  }

  const spawn = (
    command: ChildProcess.StandardCommand,
    opts: NodeChildProcess.SpawnOptions,
    direct: boolean, // kilocode_change - avoid shadowing settle
  ) =>
    Effect.callback<Spawned, PlatformError.PlatformError>((resume) => {
      // kilocode_change
      // kilocode_change start
      const signal = Deferred.makeUnsafe<Status>()
      const leader = direct ? signal : Deferred.makeUnsafe<Status>()
      // kilocode_change end
      const proc = launch(command.command, command.args, opts)
      tapStdio(proc) // kilocode_change - must run in the same tick as spawn
      let end = false
      let exit: Status | undefined // kilocode_change
      proc.on("error", (err) => {
        resume(Effect.fail(toPlatformError("spawn", err, command)))
      })
      proc.on("exit", (...args) => {
        exit = args
        Deferred.doneUnsafe(leader, Exit.succeed(args)) // kilocode_change
      })
      proc.on("close", (...args) => {
        if (end) return
        end = true
        Deferred.doneUnsafe(leader, Exit.succeed(exit ?? args)) // kilocode_change
        Deferred.doneUnsafe(signal, Exit.succeed(exit ?? args))
      })
      proc.on("spawn", () => {
        resume(Effect.succeed([proc, signal, leader])) // kilocode_change
      })
      return Effect.sync(() => {
        proc.kill("SIGTERM")
      })
    })

  const killGroup = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    signal: NodeJS.Signals,
  ) => {
    if (globalThis.process.platform === "win32") {
      return Effect.callback<void, PlatformError.PlatformError>((resume) => {
        // kilocode_change start - bound the Windows tree kill itself
        const child = NodeChildProcess.execFile(
          "taskkill",
          ["/pid", String(proc.pid), "/T", "/F"],
          { windowsHide: true, timeout: 3_000 },
          (err) => {
            if (err) return resume(Effect.fail(toPlatformError("kill", toError(err), command)))
            resume(Effect.void)
          },
        )
        return Effect.sync(() => {
          child.kill()
        })
        // kilocode_change end
      })
    }

    return Effect.try({
      try: () => {
        globalThis.process.kill(-proc.pid!, signal)
      },
      catch: (err) => toPlatformError("kill", toError(err), command),
    })
  }

  const killOne = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    signal: NodeJS.Signals,
  ) =>
    Effect.suspend(() => {
      if (proc.kill(signal)) return Effect.void
      return Effect.fail(toPlatformError("kill", new Error("Failed to kill child process"), command))
    })

  // kilocode_change start - termination waits for the foreground process, never inherited pipes
  const missing = (err: PlatformError.PlatformError) =>
    err.cause instanceof Error && "code" in err.cause && err.cause.code === "ESRCH"

  const stop = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    leader: ExitSignal,
    group: boolean,
    opts?: ChildProcess.KillOptions,
  ) => {
    const wait = Deferred.await(leader).pipe(Effect.asVoid, Effect.interruptible)
    const send = (sig: NodeJS.Signals) =>
      Effect.gen(function* () {
        if (group) return yield* killGroup(command, proc, sig).pipe(Effect.catchIf(missing, () => Effect.void))
        if (yield* Deferred.isDone(leader)) return undefined
        const one = killOne(command, proc, sig).pipe(
          Effect.catch((err) =>
            wait.pipe(Effect.timeoutOrElse({ duration: "100 millis", orElse: () => Effect.fail(err) })),
          ),
        )
        return yield* process.platform === "win32" ? killGroup(command, proc, sig).pipe(Effect.catch(() => one)) : one
      }).pipe(Effect.andThen(wait))
    const attempt = send(opts?.killSignal ?? "SIGTERM")
    if (!opts?.forceKillAfter) return attempt
    return attempt.pipe(
      Effect.timeoutOrElse({
        duration: opts.forceKillAfter,
        orElse: () =>
          send("SIGKILL").pipe(
            Effect.interruptible,
            Effect.timeoutOrElse({
              duration: "1 second",
              orElse: () =>
                Effect.fail(toPlatformError("kill", new Error("Child process did not exit after SIGKILL"), command)),
            }),
          ),
      }),
    )
  }
  // kilocode_change end

  const source = (handle: ChildProcessHandle, from: ChildProcess.PipeFromOption | undefined) => {
    const opt = from ?? "stdout"
    switch (opt) {
      case "stdout":
        return handle.stdout
      case "stderr":
        return handle.stderr
      case "all":
        return handle.all
      default: {
        const fd = ChildProcess.parseFdName(opt)
        return Predicate.isNotUndefined(fd) ? handle.getOutputFd(fd) : handle.stdout
      }
    }
  }

  const spawnCommand: (
    command: ChildProcess.Command,
  ) => Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope> = Effect.fnUntraced(
    function* (command) {
      switch (command._tag) {
        case "StandardCommand": {
          const validation = SpawnValidation.take(command) // kilocode_change - retain target validation through preparation
          const direct = SpawnExit.take(command) // kilocode_change - opt selected commands into direct-exit settlement
          const dir = yield* cwd(command.options)
          // kilocode_change start - prepare agent-scoped commands through the selected sandbox backend
          const target = yield* prepareSandbox(command, dir, env(command.options))
          const sin = stdin(target.options)
          const sout = stdio(target.options, "stdout")
          const serr = stdio(target.options, "stderr")
          const extra = fds(target.options)
          // kilocode_change end

          // kilocode_change start - close target-swap races at the raw spawn boundary
          if (validation)
            yield* validation.pipe(
              Effect.mapError((cause) =>
                PlatformError.systemError({
                  _tag: "Unknown",
                  module: "ChildProcess",
                  method: "validate",
                  pathOrDescriptor: command.command,
                  cause,
                }),
              ),
            )
          // kilocode_change end

          // kilocode_change start - only signal the group created by this spawn
          const detached = target.options.detached ?? process.platform !== "win32"
          const group = detached && process.platform !== "win32"
          const [proc, signal, leader] = yield* Effect.acquireRelease(
            // kilocode_change end
            // kilocode_change start - spawn the prepared command and options
            spawn(
              target,
              {
                cwd: dir,
                env: env(target.options),
                stdio: stdios(sin, sout, serr, extra),
                detached,
                shell: target.options.shell,
                // kilocode_change end
                windowsHide: process.platform === "win32",
              },
              direct, // kilocode_change
            ),
            // kilocode_change start - release direct-exit commands' owned process group and local pipes
            ([proc, signal, leader]) => {
              const release = Effect.gen(function* () {
                const done = yield* Deferred.isDone(signal)
                if (!done) yield* stop(command, proc, leader, group, target.options)
                if (!group) return
                if (direct) {
                  // Send only to the isolated group; a child that detached is not ours to kill.
                  yield* killGroup(command, proc, target.options.killSignal ?? "SIGTERM").pipe(
                    Effect.andThen(Effect.sleep("100 millis")),
                    Effect.andThen(killGroup(command, proc, "SIGKILL")),
                  )
                  return
                }
                if (!done) return
                const [code] = yield* Deferred.await(signal)
                if (code !== 0 && Predicate.isNotNull(code))
                  yield* killGroup(command, proc, target.options.killSignal ?? "SIGTERM")
              }).pipe(
                Effect.catchIf(missing, () => Effect.void),
                Effect.catch((err) =>
                  Effect.logWarning("Could not clean up child process", { pid: proc.pid, reason: err.reason._tag }),
                ),
              )
              return direct ? release.pipe(Effect.ensuring(Effect.sync(() => releaseStdio(proc)))) : release
            },
            // kilocode_change end
          )

          const fd = yield* setupFds(command, proc, extra)
          const out = setupOutput(command, proc, sout, serr)
          let ref = true
          return makeHandle({
            pid: ProcessId(proc.pid!),
            stdin: yield* setupStdin(command, proc, sin),
            stdout: out.stdout,
            stderr: out.stderr,
            all: out.all,
            getInputFd: fd.getInputFd,
            getOutputFd: fd.getOutputFd,
            isRunning: Effect.map(Deferred.isDone(signal), (done) => !done),
            exitCode: Effect.flatMap(Deferred.await(signal), settle), // kilocode_change - signal termination settles as 128 + signum
            kill: (opts) => stop(command, proc, leader, group, opts), // kilocode_change
            unref: Effect.sync(() => {
              if (ref) {
                proc.unref()
                ref = false
              }
              return Effect.sync(() => {
                if (!ref) {
                  proc.ref()
                  ref = true
                }
              })
            }),
          })
        }
        case "PipedCommand": {
          const flat = flatten(command)
          const [head, ...tail] = flat.commands
          let handle = spawnCommand(head)
          for (let i = 0; i < tail.length; i++) {
            const next = tail[i]
            const opts = flat.opts[i] ?? {}
            const sin = stdin(next.options)
            const stream = Stream.unwrap(Effect.map(handle, (x) => source(x, opts.from)))
            const to = opts.to ?? "stdin"
            if (to === "stdin") {
              handle = spawnCommand(
                ChildProcess.make(next.command, next.args, {
                  ...next.options,
                  stdin: { ...sin, stream },
                }),
              )
              continue
            }
            const fd = ChildProcess.parseFdName(to)
            if (Predicate.isUndefined(fd)) {
              handle = spawnCommand(
                ChildProcess.make(next.command, next.args, {
                  ...next.options,
                  stdin: { ...sin, stream },
                }),
              )
              continue
            }
            handle = spawnCommand(
              ChildProcess.make(next.command, next.args, {
                ...next.options,
                additionalFds: {
                  ...next.options.additionalFds,
                  [ChildProcess.fdName(fd) as `fd${number}`]: { type: "input", stream },
                },
              }),
            )
          }
          return yield* handle
        }
      }
    },
  )

  return makeSpawner(spawnCommand)
})

const layer: Layer.Layer<ChildProcessSpawner, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
  ChildProcessSpawner,
  make,
)

export const node = makeGlobalNode({ service: ChildProcessSpawner, layer, deps: [filesystem, path] })

export * as CrossSpawnSpawner from "./cross-spawn-spawner"
