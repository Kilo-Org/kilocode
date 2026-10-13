import { describe, expect, mock, spyOn, test } from "bun:test"
import * as child from "node:child_process"
import { once } from "node:events"
import * as fs from "fs/promises"
import path from "node:path"
import { BackgroundProcess } from "@/kilocode/background-process"
import { BackgroundProcessRunner } from "@/kilocode/background-process/runner"
import { BackgroundProcessWindows } from "@/kilocode/background-process/windows"
import { Process } from "@/util/process"
import { SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const original = { ...fs }
const processes = { ...child }
const gate: {
  file?: string
  output?: "error" | "hang"
  watch?: { reached: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> }
  probe?: "error" | "hang"
  reached?: PromiseWithResolvers<void>
  release?: PromiseWithResolvers<void>
  proc?: child.ChildProcess
} = {}

async function blockedProbe() {
  if (!gate.probe) return
  gate.reached?.resolve()
  if (gate.probe === "error") throw new Error("test probe failure")
  await gate.release?.promise
}

const stat = async (...args: Parameters<typeof fs.stat>) => {
  if (String(args[0]) === gate.file) {
    if (gate.watch) {
      const watch = gate.watch
      gate.watch = undefined
      watch.reached.resolve()
      await watch.release.promise
    }
    if (gate.output === "error") throw new Error("test output failure")
    if (gate.output === "hang") await gate.release?.promise
  }
  return original.stat(...args)
}

const readFile = async (...args: Parameters<typeof fs.readFile>) => {
  if (gate.proc?.pid && typeof args[0] === "string" && args[0].startsWith(`/proc/${gate.proc.pid}/`))
    await blockedProbe()
  return original.readFile(...args)
}

void mock.module("fs/promises", () => ({ ...original, stat, readFile }))

async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 10_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(20)
  }
  throw new Error(message)
}

async function fixture(
  run: (input: {
    id: BackgroundProcess.ID
    proc: child.ChildProcess
    exit: () => Promise<void>
    release: () => void
  }) => Promise<void>,
  order: "watch" | "event" = "event",
  signal = false,
) {
  await using tmp = await tmpdir()
  const flag = path.join(tmp.path, "exit.flag")
  const file = path.join(tmp.path, "owned.mjs")
  await Bun.write(
    file,
    `import fs from "node:fs"\nconsole.log("READY_EXIT")\nsetInterval(() => { if (fs.existsSync(${JSON.stringify(flag)})) process.exit(1) }, 20)\n`,
  )
  let proc: child.ChildProcess | undefined
  let release: (() => void) | undefined
  let emitted = false
  const spawned = spyOn(child, "spawn").mockImplementation(
    new Proxy(processes.spawn, {
      apply(spawn, receiver, args) {
        const next: child.ChildProcess = Reflect.apply(spawn, receiver, args)
        proc = next
        gate.proc = next
        if (order === "watch") {
          const emit = next.emit.bind(next)
          spyOn(next, "emit").mockImplementation(
            new Proxy(emit, {
              apply(fn, receiver, args) {
                if (args[0] === "exit" && !emitted) {
                  emitted = true
                  release = () => Reflect.apply(fn, receiver, args)
                  return true
                }
                return Reflect.apply(fn, receiver, args)
              },
            }),
          )
        }
        return next
      },
    }),
  )
  const command = spyOn(BackgroundProcessRunner, "command").mockImplementation((input) => [
    process.execPath,
    file,
    "__background-process-runner",
    input.token,
  ])
  const native = spyOn(BackgroundProcessWindows, "command").mockImplementation(async (pid) => {
    await blockedProbe()
    if (!proc || proc.pid !== pid || proc.exitCode !== null || proc.signalCode !== null) return { live: false }
    const input = command.mock.calls.at(0)?.at(0)
    return { live: true, line: `__background-process-runner ${input?.token}` }
  })
  const text = Process.text
  const query = spyOn(Process, "text").mockImplementation(async (args, opts) => {
    if (args[0] === "ps") {
      await blockedProbe()
      const input = command.mock.calls.at(0)?.at(0)
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        text:
          proc?.pid && proc.exitCode === null && proc.signalCode === null
            ? `${proc.pid} ${proc.pid} ${input?.token}`
            : "",
      }
    }
    return text(args, opts)
  })
  try {
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const info = await BackgroundProcess.start({
          sessionID: SessionID.descending(),
          command: "synthetic owned exit",
          cwd: tmp.path,
          lifetime: "persistent",
          ready: { pattern: "READY_EXIT", timeout: 10_000 },
        })
        const owned = proc
        if (!owned) throw new Error("owned ChildProcess missing")
        const scope = `scope-${Hash.fast(`global\0${Filesystem.resolve(tmp.path)}`)}`
        gate.file = path.join(Global.Path.log, "background-process", scope, `${info.id}.log`)
        await run({
          id: info.id,
          proc: owned,
          release: () => release?.(),
          exit: async () => {
            if (signal) owned.kill("SIGTERM")
            else await Bun.write(flag, "exit")
            await until(() => owned.exitCode !== null || owned.signalCode !== null, "owned child did not exit")
          },
        })
      },
    })
  } finally {
    gate.release?.resolve()
    gate.watch?.release.resolve()
    release?.()
    delete gate.file
    delete gate.output
    delete gate.watch
    delete gate.probe
    delete gate.reached
    delete gate.release
    delete gate.proc
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const ended = once(proc, "exit")
      proc.kill("SIGKILL")
      await ended
    }
    query.mockRestore()
    native.mockRestore()
    command.mockRestore()
    spawned.mockRestore()
  }
}

describe("owned background process exit", () => {
  for (const order of ["watch", "event"] as const) {
    for (const signal of [false, true]) {
      test(`keeps the real ${signal ? "signal" : "exit code"} when ${order} finishes first`, async () => {
        await fixture(
          async ({ id, proc, exit, release }) => {
            const held =
              order === "event"
                ? { reached: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
                : undefined
            if (held) {
              gate.watch = held
              await held.reached.promise
            }
            try {
              await exit()
              await until(
                async () => (await BackgroundProcess.get(id))?.time.ended !== undefined,
                "owned job stayed non-terminal",
              )
              const info = await BackgroundProcess.get(id)
              expect(info?.status).toBe("failed")
              if (signal) {
                expect(proc.signalCode).toBe("SIGTERM")
                expect(info?.signal).toBe("SIGTERM")
                expect(info?.exitCode).toBeUndefined()
              } else {
                expect(proc.exitCode).toBe(1)
                expect(info?.exitCode).toBe(1)
                expect(info?.signal).toBeUndefined()
              }
            } finally {
              release()
              held?.release.resolve()
            }
            await Bun.sleep(100)
            expect((await BackgroundProcess.get(id))?.exitCode).toBe(signal ? undefined : 1)
            expect((await BackgroundProcess.get(id))?.signal).toBe(signal ? "SIGTERM" : undefined)
          },
          order,
          signal,
        )
      }, 30_000)
    }
  }

  for (const source of ["output", "probe"] as const) {
    for (const failure of ["error", "hang"] as const) {
      test(`finalizes the owned exit when ${source} ${failure === "hang" ? "hangs" : "fails"}`, async () => {
        await fixture(async ({ id, proc, exit }) => {
          gate.release = Promise.withResolvers<void>()
          if (source === "output") gate.output = failure
          else {
            gate.reached = Promise.withResolvers<void>()
            gate.probe = failure
            await gate.reached.promise
          }
          const started = Date.now()
          await exit()
          await until(
            async () => (await BackgroundProcess.get(id))?.time.ended !== undefined,
            "finalizer exceeded its bound",
            3_000,
          )
          const info = await BackgroundProcess.get(id)
          expect(proc.exitCode).toBe(1)
          expect(info?.status).toBe("failed")
          expect(info?.exitCode).toBe(1)
          expect(Date.now() - started).toBeLessThan(3_000)
        })
      }, 30_000)
    }
  }
})
