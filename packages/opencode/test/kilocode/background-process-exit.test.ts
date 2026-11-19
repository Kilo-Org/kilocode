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
let gate: {
  pid?: number
  token?: string
  group?: "owned" | "gone"
  gone?: number
  ended?: boolean
  file?: string
  watch?: PromiseWithResolvers<void>
  reached?: PromiseWithResolvers<void>
} = {}

const stat = async (...args: Parameters<typeof fs.stat>) => {
  if (String(args[0]) === gate.file && gate.watch) {
    const held = gate.watch
    gate.watch = undefined
    gate.reached?.resolve()
    await held.promise
  }
  return original.stat(...args)
}

const readFile = async (...args: Parameters<typeof fs.readFile>) => {
  if (gate.pid && typeof args[0] === "string" && args[0].startsWith(`/proc/${gate.pid}/`)) {
    if (gate.group === "gone" || (gate.ended && gate.group !== "owned"))
      throw Object.assign(new Error("gone"), { code: "ENOENT" })
    if (args[0].endsWith("/stat")) return `${gate.pid} (fixture) S 1 ${gate.pid} 0 0`
    if (args[0].endsWith("/environ")) return Buffer.from(`KILO_BACKGROUND_PROCESS_TOKEN=${gate.token}\0`)
  }
  return original.readFile(...args)
}

const readdir = new Proxy(original.readdir, {
  apply(fn, receiver, args) {
    if (args[0] === "/proc" && gate.pid) {
      if (gate.group !== "owned") gate.gone = (gate.gone ?? 0) + 1
      return Promise.resolve(gate.group === "owned" ? [String(gate.pid)] : [])
    }
    return Reflect.apply(fn, receiver, args)
  },
})
void mock.module("fs/promises", () => ({ ...original, stat, readFile, readdir }))

async function until(check: () => boolean | Promise<boolean>, message: string) {
  const end = Date.now() + 20_000
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
  mode: "watch" | "event" | "unreported" | "adopted" = "watch",
  signal = false,
) {
  gate = {}
  await using tmp = await tmpdir()
  const flag = path.join(tmp.path, "exit.flag")
  const file = path.join(tmp.path, "owned.mjs")
  await Bun.write(
    file,
    `import fs from "node:fs"\nconsole.log("READY_EXIT")\nsetInterval(() => { if (fs.existsSync(${JSON.stringify(flag)})) process.exit(1) }, 20)\n`,
  )
  let proc: child.ChildProcess | undefined
  let release: (() => void) | undefined
  let held = false
  const spawned = spyOn(child, "spawn").mockImplementation(
    new Proxy(processes.spawn, {
      apply(fn, receiver, args) {
        const next: child.ChildProcess = Reflect.apply(fn, receiver, args)
        proc = next
        gate.pid = next.pid
        if (mode === "watch" || mode === "unreported") {
          const emit = next.emit.bind(next)
          spyOn(next, "emit").mockImplementation(
            new Proxy(emit, {
              apply(fn, receiver, args) {
                if (args[0] === "exit" && !held) {
                  held = true
                  gate.ended = true
                  const code = next.exitCode
                  const end = next.signalCode
                  if (mode === "unreported") {
                    Object.defineProperty(next, "exitCode", { value: null, writable: true })
                    Object.defineProperty(next, "signalCode", { value: null, writable: true })
                  }
                  release = () => {
                    Object.defineProperty(next, "exitCode", { value: code, writable: true })
                    Object.defineProperty(next, "signalCode", { value: end, writable: true })
                    return Reflect.apply(fn, receiver, args)
                  }
                  return true
                }
                return Reflect.apply(fn, receiver, args)
              },
            }),
          )
        } else
          next.once("exit", () => {
            gate.ended = true
          })
        return next
      },
    }),
  )
  const command = spyOn(BackgroundProcessRunner, "command").mockImplementation((input) => {
    gate.token = input.token
    return [process.execPath, file, "__background-process-runner", input.token]
  })
  const native = spyOn(BackgroundProcessWindows, "command").mockImplementation(async () => {
    if (gate.group === "gone" || (gate.ended && gate.group !== "owned")) {
      gate.gone = (gate.gone ?? 0) + 1
      return { live: false }
    }
    return { live: true, line: `__background-process-runner ${gate.token}` }
  })
  const text = Process.text
  const query = spyOn(Process, "text").mockImplementation(async (args, opts) => {
    if (args[0] === "ps") {
      if (gate.group === "gone" || (gate.ended && gate.group !== "owned")) gate.gone = (gate.gone ?? 0) + 1
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        text:
          gate.group === "gone" || (gate.ended && gate.group !== "owned")
            ? ""
            : `${gate.pid} ${gate.pid} __background-process-runner ${gate.token}`,
      }
    }
    return text(args, opts)
  })
  try {
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const scope = `scope-${Hash.fast(`global\0${Filesystem.resolve(tmp.path)}`)}`
        let id: BackgroundProcess.ID
        if (mode === "adopted") {
          id = BackgroundProcess.ID.ascending()
          gate.token = `adopted-${id}`
          proc = processes.spawn(process.execPath, [file, "__background-process-runner", gate.token], {
            stdio: "ignore",
            windowsHide: true,
          })
          gate.pid = proc.pid
          proc.once("exit", () => {
            gate.ended = true
          })
          const directory = path.join(Global.Path.state, "background-process", scope)
          await fs.mkdir(directory, { recursive: true })
          const now = Date.now()
          const sessionID = SessionID.descending()
          await Bun.write(
            path.join(directory, `${id}.json`),
            JSON.stringify({
              scope: scope.replace("scope-", "scope:"),
              token: gate.token,
              info: {
                id,
                sessionID,
                pid: proc.pid,
                command: "synthetic adopted exit",
                cwd: tmp.path,
                ports: [],
                status: "running",
                lifetime: "persistent",
                ready: false,
                output: "",
                time: { started: now, updated: now },
              },
              start: { sessionID, command: "synthetic adopted exit", cwd: tmp.path, lifetime: "persistent" },
            }),
          )
          expect((await BackgroundProcess.get(id))?.pid).toBe(proc.pid)
        } else {
          id = (
            await BackgroundProcess.start({
              sessionID: SessionID.descending(),
              command: "synthetic owned exit",
              cwd: tmp.path,
              lifetime: "persistent",
              ready: { pattern: "READY_EXIT", timeout: 10_000 },
            })
          ).id
        }
        const owned = proc
        if (!owned) throw new Error("ChildProcess missing")
        gate.file = path.join(Global.Path.log, "background-process", scope, `${id}.log`)
        await run({
          id,
          proc: owned,
          release: () => {
            if (mode === "watch" || mode === "unreported") expect(held).toBe(true)
            release?.()
          },
          exit: async () => {
            if (signal) owned.kill("SIGTERM")
            else await Bun.write(flag, "exit")
            await until(() => gate.ended === true, "real child did not exit")
          },
        })
      },
    })
  } finally {
    gate.watch?.resolve()
    release?.()
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const ended = once(proc, "exit")
      proc.kill("SIGKILL")
      await ended
    }
    gate = {}
    query.mockRestore()
    native.mockRestore()
    command.mockRestore()
    spawned.mockRestore()
  }
}

describe("background process exit after the group is gone", () => {
  for (const signal of [false, true])
    test(`watch preserves the owned ${signal ? "signal" : "exit code"}`, async () => {
      await fixture(
        async ({ id, proc, exit, release }) => {
          await exit()
          try {
            await until(async () => (await BackgroundProcess.get(id))?.time.ended !== undefined, "job did not finish")
            const info = await BackgroundProcess.get(id)
            expect(info?.status).toBe("failed")
            expect(info?.exitCode).toBe(signal ? undefined : 1)
            expect(info?.signal).toBe(signal ? "SIGTERM" : undefined)
            expect(signal ? proc.signalCode : proc.exitCode).toBe(signal ? "SIGTERM" : 1)
          } finally {
            release()
          }
        },
        "watch",
        signal,
      )
    }, 30_000)

  test("gone before the owned end is reported waits for the real exit event", async () => {
    await fixture(async ({ id, exit, release }) => {
      await exit()
      gate.group = "gone"
      const before = gate.gone ?? 0
      try {
        await until(() => (gate.gone ?? 0) > before, "the watch never observed the gone group")
        await Bun.sleep(50)
        const info = await BackgroundProcess.get(id)
        if (!info) throw new Error("owned job disappeared")
        expect(["running", "ready"]).toContain(info.status)
        expect(info?.exitCode).toBeUndefined()
      } finally {
        release()
      }
      await until(async () => (await BackgroundProcess.get(id))?.time.ended !== undefined, "real exit did not finalize")
      expect((await BackgroundProcess.get(id))?.exitCode).toBe(1)
    }, "unreported")
  }, 30_000)

  // This case guards the normal exit-handler path; it does not exercise the watch change.
  test("the owning exit handler preserves its code when it runs first", async () => {
    await fixture(async ({ id, exit }) => {
      gate.reached = Promise.withResolvers<void>()
      const held = Promise.withResolvers<void>()
      gate.watch = held
      await gate.reached.promise
      await exit()
      held.resolve()
      await until(
        async () => (await BackgroundProcess.get(id))?.time.ended !== undefined,
        "exit handler did not finalize",
      )
      expect((await BackgroundProcess.get(id))?.exitCode).toBe(1)
    }, "event")
  }, 30_000)

  test("an adopted job without a ChildProcess keeps its zero-code behavior", async () => {
    await fixture(async ({ id, exit }) => {
      await exit()
      await until(
        async () => (await BackgroundProcess.get(id))?.time.ended !== undefined,
        "adopted job did not finalize",
      )
      expect((await BackgroundProcess.get(id))?.status).toBe("exited")
      expect((await BackgroundProcess.get(id))?.exitCode).toBe(0)
    }, "adopted")
  }, 30_000)

  test("a surviving group stays manageable after the owned leader ends", async () => {
    await fixture(async ({ id, exit }) => {
      gate.group = "owned"
      await exit()
      await Bun.sleep(350)
      const info = await BackgroundProcess.get(id)
      if (!info) throw new Error("owned group disappeared")
      expect(["running", "ready"]).toContain(info.status)
      expect((await BackgroundProcess.get(id))?.time.ended).toBeUndefined()
      gate.group = "gone"
      await until(
        async () => (await BackgroundProcess.get(id))?.time.ended !== undefined,
        "gone group did not finalize",
      )
      expect((await BackgroundProcess.get(id))?.exitCode).toBe(1)
    }, "event")
  }, 30_000)
})
