import { Flag } from "@opencode-ai/core/flag/flag"
import { Process } from "@/util/process"
import { Shell } from "@/shell/shell"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"

export namespace CommandTimeout {
  export type Limit = {
    timeout: number
    capped: boolean
  }

  export function clamp(timeout: number): Limit {
    const cap = Flag.KILO_COMMAND_TIMEOUT_MAX_MS
    if (!cap || timeout < cap) return { timeout, capped: false }
    return { timeout: cap, capped: true }
  }

  export function env(): Limit | undefined {
    const cap = Flag.KILO_COMMAND_TIMEOUT_MAX_MS
    if (!cap) return
    return { timeout: cap, capped: true }
  }

  export function note(limit: Limit, text: string) {
    const msg = Flag.KILO_COMMAND_TIMEOUT_MAX_MS_MESSAGE?.trim()
    const base = `${text} after exceeding environment timeout ${limit.timeout} ms.`
    return msg ? `${base} ${msg}` : base
  }

  export function wait<A, E, R>(handle: ChildProcessHandle, drain: Effect.Effect<A, E, R>, limit: Limit) {
    return Effect.raceFirst(
      Effect.all([handle.exitCode, drain], { concurrency: 2 }).pipe(Effect.as(false)),
      Effect.sleep(`${limit.timeout} millis`).pipe(Effect.as(true)),
    ).pipe(
      Effect.flatMap((expired) => {
        if (!expired) return Effect.succeed(false)
        return handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie, Effect.as(true))
      }),
    )
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
      const drain = Effect.all(
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
      const expired = yield* wait(handle, drain, limit)
      if (!expired) return text

      const note = CommandTimeout.note(limit, "shell command terminated")
      return text ? `${text}\n\n${note}` : note
    }).pipe(Effect.scoped, Effect.orDie)
  }
}
