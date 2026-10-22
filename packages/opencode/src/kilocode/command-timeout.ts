import { Process } from "@/util/process"
import { Shell } from "@opencode-ai/core/shell"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"

function max() {
  const value = process.env.KILO_COMMAND_TIMEOUT_MAX_MS
  if (!value) return
  const timeout = Number(value)
  return Number.isInteger(timeout) && timeout > 0 ? timeout : undefined
}

export namespace CommandTimeout {
  export type Limit = {
    timeout: number
    capped: boolean
  }

  export function clamp(timeout: number): Limit {
    const cap = max()
    if (!cap || timeout < cap) return { timeout, capped: false }
    return { timeout: cap, capped: true }
  }

  export function env(): Limit | undefined {
    const cap = max()
    if (!cap) return
    return { timeout: cap, capped: true }
  }

  export function note(limit: Limit, text: string) {
    const msg = process.env.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE?.trim()
    const base = `${text} after exceeding environment timeout ${limit.timeout} ms.`
    return msg ? `${base} ${msg}` : base
  }

  export function message(timeout: number, text: string) {
    const limit = env()
    if (!limit || limit.timeout !== timeout) return
    return note(limit, text)
  }

  export function duration(timeout: number) {
    return env()?.timeout === timeout ? timeout : timeout + 100
  }

  export function wait<A, E, R>(handle: ChildProcessHandle, output: Effect.Effect<A, E, R>, limit: Limit) {
    return Effect.raceFirst(
      Effect.all([handle.exitCode, output], { concurrency: 2 }).pipe(Effect.as(false)),
      Effect.sleep(`${limit.timeout} millis`).pipe(Effect.as(true)),
    ).pipe(
      Effect.flatMap((expired) => {
        if (!expired) return Effect.succeed(false)
        return handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie, Effect.as(true))
      }),
    )
  }

  export function drain<A, E, R>(handle: ChildProcessHandle, output: Effect.Effect<A, E, R>, text: string) {
    const limit = env()
    if (!limit) return output.pipe(Effect.andThen(handle.exitCode), Effect.as(undefined))
    return wait(handle, output, limit).pipe(Effect.map((expired) => (expired ? note(limit, text) : undefined)))
  }

  function make(cmd: string, shell: string) {
    if (process.platform === "win32" && Shell.ps(shell)) {
      return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", cmd], {
        stdin: "ignore",
        detached: false,
      })
    }

    return ChildProcess.make(cmd, [], {
      shell,
      stdin: "ignore",
      detached: process.platform !== "win32",
    })
  }

  export function text(cmd: string, shell: string) {
    const limit = env()
    if (!limit) return Effect.promise(async () => (await Process.text([cmd], { shell, nothrow: true })).text)

    return Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(make(cmd, shell))
      let text = ""
      const output = Effect.all(
        [
          Stream.runForEach(Stream.decodeText(handle.stdout), (chunk) =>
            Effect.sync(() => {
              text += chunk
            }),
          ),
          Stream.runDrain(handle.stderr),
        ],
        { concurrency: 2 },
      )
      const expired = yield* wait(handle, output, limit)
      if (!expired) return text

      const msg = note(limit, "shell command terminated")
      return text ? `${text}\n\n${msg}` : msg
    }).pipe(Effect.scoped, Effect.orDie)
  }

  export function texts(cmds: string[], shell: string) {
    return Effect.all(
      cmds.map((cmd) => text(cmd, shell)),
      { concurrency: "unbounded" },
    )
  }
}
