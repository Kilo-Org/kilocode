import { expect, mock } from "bun:test"
import { SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, it } from "../lib/effect"

const read = fs.readFile
const probe: {
  reached?: PromiseWithResolvers<void>
  release?: PromiseWithResolvers<void>
} = {}
const blocked = async (...args: Parameters<typeof read>) => {
  const reached = probe.reached
  if (reached && typeof args[0] === "string" && /^\/proc\/\d+\/stat$/.test(args[0])) {
    probe.reached = undefined
    reached.resolve()
    await probe.release?.promise
  }
  return read(...args)
}

void mock.module("fs/promises", () => ({
  ...fs,
  readFile: blocked,
}))

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

function artifacts(dir: string, id: string) {
  const scope = `scope-${Hash.fast(`global\0${Filesystem.resolve(dir)}`)}`
  return {
    manifest: path.join(Global.Path.state, "background-process", scope, `${id}.json`),
    log: path.join(Global.Path.log, "background-process", scope, `${id}.log`),
    control: path.join(Global.Path.state, "background-process", scope, `${id}.stop`),
  }
}

function alive(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it.instance("does not recreate a stopped process manifest during shutdown", () =>
  Effect.gen(function* () {
    if (process.platform !== "linux") return
    const { BackgroundProcess } = yield* Effect.promise(() => import("../../src/kilocode/background-process"))
    const test = yield* TestInstance
    const sessionID = SessionID.descending()
    const file = path.join(test.directory, "stopped-persistent.mjs")
    yield* Effect.promise(() => Bun.write(file, "setInterval(() => {}, 1_000)\n"))
    const info = yield* Effect.promise(() =>
      BackgroundProcess.start({
        sessionID,
        command: `${quote(process.execPath)} ${quote(file)}`,
        cwd: test.directory,
        lifetime: "persistent",
      }),
    )
    const files = artifacts(test.directory, info.id)

    try {
      expect(yield* Effect.promise(() => Bun.file(files.manifest).exists())).toBe(true)
      yield* Effect.promise(() => BackgroundProcess.stop(info.id))
      expect(yield* Effect.promise(() => Bun.file(files.manifest).exists())).toBe(false)

      yield* Effect.promise(() => BackgroundProcess.shutdown())

      expect(yield* Effect.promise(() => Bun.file(files.manifest).exists())).toBe(false)
    } finally {
      yield* Effect.promise(() => Promise.allSettled([BackgroundProcess.stop(info.id)]))
      yield* Effect.promise(() => BackgroundProcess.shutdown())
      yield* Effect.promise(() =>
        Promise.allSettled([files.manifest, files.log, files.control].map((file) => fs.rm(file, { force: true }))),
      )
    }
  }),
)

it.instance("persists a process when shutdown races its initial manifest", () =>
  Effect.gen(function* () {
    if (process.platform !== "linux") return
    const { BackgroundProcess } = yield* Effect.promise(() => import("../../src/kilocode/background-process"))
    const test = yield* TestInstance
    const sessionID = SessionID.descending()
    const file = path.join(test.directory, "persistent-shutdown-race.mjs")
    yield* Effect.promise(() => Bun.write(file, "setInterval(() => {}, 1_000)\n"))
    const command = `${quote(process.execPath)} ${quote(file)}`
    const reached = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const state: { id?: Parameters<typeof BackgroundProcess.stop>[0]; pid?: number } = {}
    yield* Effect.promise(() => BackgroundProcess.shutdown())
    probe.reached = reached
    probe.release = release
    const launch = BackgroundProcess.start({
      sessionID,
      command,
      cwd: test.directory,
      lifetime: "persistent",
    })

    try {
      yield* awaitWithTimeout(
        Effect.promise(() => reached.promise),
        "persistent process never entered identity verification",
        "5 seconds",
      )
      const [active] = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
      expect(active).toBeDefined()
      state.id = active?.id
      state.pid = active?.pid
      if (!state.id) throw new Error("Persistent process was not registered")
      const files = artifacts(test.directory, state.id)
      expect(yield* Effect.promise(() => Bun.file(files.manifest).exists())).toBe(false)

      yield* Effect.promise(() => BackgroundProcess.shutdown())

      expect(yield* Effect.promise(() => Bun.file(files.manifest).exists())).toBe(true)
      release.resolve()
      const info = yield* Effect.promise(() => launch)
      const adopted = yield* Effect.promise(() => BackgroundProcess.get(info.id))
      expect(adopted?.pid).toBe(info.pid)
      expect(adopted?.lifetime).toBe("persistent")
    } finally {
      probe.reached = undefined
      probe.release = undefined
      release.resolve()
      const result = yield* Effect.promise(() =>
        launch.then(
          (info) => ({ ok: true as const, info }),
          (err) => ({ ok: false as const, err }),
        ),
      )
      if (!result.ok) console.error("persistent test process failed to launch", result.err)
      const id = state.id ?? (result.ok ? result.info.id : undefined)
      const pid = state.pid ?? (result.ok ? result.info.pid : undefined)
      if (id) yield* Effect.promise(() => Promise.allSettled([BackgroundProcess.stop(id)]))
      if (pid && alive(pid)) {
        try {
          process.kill(-pid, "SIGKILL")
        } catch (err) {
          if (alive(pid)) console.error("failed to clean up persistent test process", err)
        }
      }
      if (id) {
        const files = artifacts(test.directory, id)
        yield* Effect.promise(() =>
          Promise.allSettled([files.manifest, files.log, files.control].map((file) => fs.rm(file, { force: true }))),
        )
      }
    }
  }),
)
