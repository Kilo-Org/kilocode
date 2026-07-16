import { describe, expect } from "bun:test"
import { Bus } from "@/bus"
import { BackgroundProcess } from "@/kilocode/background-process"
import { SessionID } from "@/session/schema"
import { Shell } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { Effect } from "effect"
import { spawn } from "child_process"
import { once } from "node:events"
import fs from "fs/promises"
import path from "path"
import { provideTestInstance, TestInstance, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function script(dir: string, name: string, source: string, exec = process.execPath) {
  const file = path.join(dir, name)
  await Bun.write(file, source)
  const bin = quote(exec)
  const arg = quote(file)
  if (Shell.ps(Shell.acceptable())) return `& ${bin} ${arg}`
  return `${bin} ${arg}`
}

function port() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = server.port
  server.stop(true)
  if (!port) throw new Error("Failed to reserve port")
  return port
}

function artifacts(dir: string, id: BackgroundProcess.ID) {
  const scope = `scope-${Hash.fast(`global\0${Filesystem.resolve(dir)}`)}`
  return {
    manifest: path.join(Global.Path.state, "background-process", scope, `${id}.json`),
    log: path.join(Global.Path.log, "background-process", scope, `${id}.log`),
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

async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(50)
  }
  throw new Error(message)
}

function update(sessionID: SessionID) {
  const state: { off?: () => void; timer?: ReturnType<typeof setTimeout> } = {}
  const promise = new Promise<BackgroundProcess.Info>((resolve, reject) => {
    state.timer = setTimeout(() => {
      state.off?.()
      reject(new Error("timed out waiting for process update"))
    }, 5_000)
    state.off = Bus.subscribe(BackgroundProcess.Event.Updated, (event) => {
      const info = event.properties.info
      if (info.sessionID !== sessionID) return
      if (!info.output.includes("tick")) return
      state.off?.()
      if (state.timer) clearTimeout(state.timer)
      resolve(info)
    })
  })
  return {
    promise,
    dispose() {
      state.off?.()
      if (state.timer) clearTimeout(state.timer)
    },
  }
}

describe("BackgroundProcess", () => {
  it.instance("starts, reports readiness, and stops a process", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "ready.mjs",
          `console.log("ready")
setInterval(() => {}, 1_000)
`,
        ),
      )

      const info = yield* Effect.promise(() =>
        BackgroundProcess.start({
          sessionID,
          command,
          cwd: test.directory,
          description: "test server",
          ready: { pattern: "ready", timeout: 5_000 },
        }),
      )

      expect(info.status).toBe("ready")
      expect(info.output).toContain("ready")

      const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
      expect(list.map((item) => item.id)).toContain(info.id)

      const stopped = yield* Effect.promise(() => BackgroundProcess.stop(info.id))
      expect(stopped?.status).toBe("stopped")
      if (process.platform !== "win32") {
        expect(stopped?.exitCode).toBeUndefined()
        expect(stopped?.signal).toBe("SIGTERM")
      }

      yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
      const next = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
      expect(next).toEqual([])
    }),
  )

  it.instance("reports explicit readiness ports for VS Code clients", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const listen = port()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "vscode-ready-port.mjs",
          `Bun.serve({ hostname: "127.0.0.1", port: ${listen}, fetch: () => new Response() })
`,
        ),
      )
      const client = process.env["KILO_CLIENT"]
      process.env["KILO_CLIENT"] = "vscode"

      try {
        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: test.directory,
            ready: { port: listen, timeout: 5_000 },
          }),
        )

        expect(info.status).toBe("ready")
        expect(info.ports).toEqual([listen])
      } finally {
        yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        if (client === undefined) delete process.env["KILO_CLIENT"]
        else process.env["KILO_CLIENT"] = client
      }
    }),
  )

  it.instance("infers ports for CLI clients", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const listen = port()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "cli-port.mjs",
          `Bun.serve({ hostname: "127.0.0.1", port: ${listen}, fetch: () => new Response() })
`,
        ),
      )
      const client = process.env["KILO_CLIENT"]
      const scans = process.env["KILO_BACKGROUND_PROCESS_PORTS"]
      process.env["KILO_CLIENT"] = "cli"
      process.env["KILO_BACKGROUND_PROCESS_PORTS"] = "true"

      try {
        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: test.directory,
          }),
        )

        let found = yield* Effect.promise(() => BackgroundProcess.get(info.id))
        if (process.platform !== "win32") {
          for (let attempt = 0; attempt < 40 && !found?.ports.includes(listen); attempt++) {
            yield* Effect.promise(() => Bun.sleep(250))
            found = yield* Effect.promise(() => BackgroundProcess.get(info.id))
          }
        }
        expect(found?.ports).toEqual(process.platform === "win32" ? [] : [listen])
      } finally {
        yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        if (client === undefined) delete process.env["KILO_CLIENT"]
        else process.env["KILO_CLIENT"] = client
        if (scans === undefined) delete process.env["KILO_BACKGROUND_PROCESS_PORTS"]
        else process.env["KILO_BACKGROUND_PROCESS_PORTS"] = scans
      }
    }),
  )

  it.instance("does not infer ports for CLI clients without opt in", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const listen = port()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "cli-no-port.mjs",
          `Bun.serve({ hostname: "127.0.0.1", port: ${listen}, fetch: () => new Response() })
`,
        ),
      )
      const client = process.env["KILO_CLIENT"]
      const scans = process.env["KILO_BACKGROUND_PROCESS_PORTS"]
      process.env["KILO_CLIENT"] = "cli"
      delete process.env["KILO_BACKGROUND_PROCESS_PORTS"]

      try {
        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: test.directory,
          }),
        )

        yield* Effect.promise(() => Bun.sleep(1_000))
        const found = yield* Effect.promise(() => BackgroundProcess.get(info.id))
        expect(found?.ports).toEqual([])
      } finally {
        yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        if (client === undefined) delete process.env["KILO_CLIENT"]
        else process.env["KILO_CLIENT"] = client
        if (scans === undefined) delete process.env["KILO_BACKGROUND_PROCESS_PORTS"]
        else process.env["KILO_BACKGROUND_PROCESS_PORTS"] = scans
      }
    }),
  )

  it.instance("does not infer ports for VS Code clients", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const listen = port()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "vscode-port.mjs",
          `Bun.serve({ hostname: "127.0.0.1", port: ${listen}, fetch: () => new Response() })
`,
        ),
      )
      const client = process.env["KILO_CLIENT"]
      process.env["KILO_CLIENT"] = "vscode"

      try {
        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: test.directory,
          }),
        )

        yield* Effect.promise(() => Bun.sleep(2_500))
        const found = yield* Effect.promise(() => BackgroundProcess.get(info.id))
        expect(found?.ports).toEqual([])
      } finally {
        yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        if (client === undefined) delete process.env["KILO_CLIENT"]
        else process.env["KILO_CLIENT"] = client
      }
    }),
  )

  it.instance("publishes output updates from process callbacks", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "tick.mjs",
          `console.log("ready")
setTimeout(() => console.log("tick"), 200)
setInterval(() => {}, 1_000)
`,
        ),
      )
      const wait = update(sessionID)
      const info = yield* Effect.promise(() =>
        BackgroundProcess.start({
          sessionID,
          command,
          cwd: test.directory,
          ready: { pattern: "ready", timeout: 5_000 },
        }),
      )

      try {
        const event = yield* Effect.promise(() => wait.promise)
        expect(event.id).toBe(info.id)
        expect(event.output).toContain("tick")
      } finally {
        wait.dispose()
        yield* Effect.promise(() => BackgroundProcess.stop(info.id))
        yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
      }
    }),
  )

  it.instance("transfers inherited processes to the parent session", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const parentID = SessionID.descending()
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "inherited.mjs",
          `console.log("ready")
setInterval(() => {}, 1_000)
`,
        ),
      )
      const info = yield* Effect.promise(() =>
        BackgroundProcess.start({
          sessionID,
          parentID,
          command,
          cwd: test.directory,
          lifetime: "parent",
          ready: { pattern: "ready", timeout: 5_000 },
        }),
      )

      yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
      const child = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
      const parent = yield* Effect.promise(() => BackgroundProcess.list({ sessionID: parentID }))
      expect(child).toEqual([])
      expect(parent).toHaveLength(1)
      expect(parent[0]?.id).toBe(info.id)
      expect(parent[0]?.lifetime).toBe("session")

      yield* Effect.promise(() => BackgroundProcess.stopSession(parentID))
      const stopped = yield* Effect.promise(() => BackgroundProcess.get(info.id))
      expect(stopped).toBeUndefined()
    }),
  )

  it.instance("re-adopts persistent processes after instance reload", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "persistent.mjs",
          `console.log("ready")
setInterval(() => console.log("tick"), 100)
`,
        ),
      )
      const info = yield* Effect.promise(() =>
        BackgroundProcess.start({
          sessionID,
          command,
          cwd: test.directory,
          lifetime: "persistent",
          ready: { pattern: "ready", timeout: 15_000 },
        }),
      )

      try {
        expect(info.status).toBe("ready")
        const otherID = SessionID.descending()
        const visible = yield* Effect.promise(() => BackgroundProcess.list({ sessionID: otherID }))
        expect(visible.map((item) => item.id)).toContain(info.id)
        const files = artifacts(test.directory, info.id)
        yield* Effect.promise(() =>
          until(async () => {
            const log = Bun.file(files.log)
            return (await log.exists()) && (await log.text()).includes("ready")
          }, "persistent process output was not flushed before reload"),
        )
        yield* Effect.promise(() => BackgroundProcess.shutdown())
        const adopted = yield* Effect.promise(() => BackgroundProcess.get(info.id))
        expect(adopted?.pid).toBe(info.pid)
        expect(adopted?.lifetime).toBe("persistent")
        expect(adopted?.output).toContain("ready")
      } finally {
        yield* Effect.promise(() => BackgroundProcess.stop(info.id))
        yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
      }
    }),
  )

  it.live("isolates persistent processes between non-git directories", () =>
    Effect.promise(async () => {
      await using first = await tmpdir()
      await using second = await tmpdir()
      const sessionID = SessionID.descending()
      const command = await script(
        first.path,
        "isolated.mjs",
        `console.log("ready")
setInterval(() => {}, 1_000)
`,
      )
      const info = await provideTestInstance({
        directory: first.path,
        fn: () =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: first.path,
            lifetime: "persistent",
            ready: { pattern: "ready", timeout: 15_000 },
          }),
      })

      try {
        const other = await provideTestInstance({
          directory: second.path,
          fn: () => BackgroundProcess.get(info.id),
        })
        expect(other).toBeUndefined()
        const own = await provideTestInstance({
          directory: first.path,
          fn: () => BackgroundProcess.get(info.id),
        })
        expect(own?.pid).toBe(info.pid)
      } finally {
        await provideTestInstance({ directory: first.path, fn: () => BackgroundProcess.stop(info.id) })
      }
    }),
  )

  it.live("shares one persistent process manager across project directories", () =>
    Effect.promise(async () => {
      await using tmp = await tmpdir({ git: true })
      const nested = path.join(tmp.path, "nested")
      await fs.mkdir(nested)
      const sessionID = SessionID.descending()
      const command = await script(
        tmp.path,
        "shared.mjs",
        `console.log("ready")
setInterval(() => {}, 1_000)
`,
      )
      const info = await provideTestInstance({
        directory: tmp.path,
        fn: () =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: tmp.path,
            lifetime: "persistent",
            ready: { pattern: "ready", timeout: 15_000 },
          }),
      })

      try {
        const shared = await provideTestInstance({ directory: nested, fn: () => BackgroundProcess.get(info.id) })
        expect(shared?.pid).toBe(info.pid)
        const restarted = await provideTestInstance({ directory: nested, fn: () => BackgroundProcess.restart(info.id) })
        expect(restarted?.pid).not.toBe(info.pid)
        const current = await provideTestInstance({ directory: tmp.path, fn: () => BackgroundProcess.get(info.id) })
        expect(current?.pid).toBe(restarted?.pid)
      } finally {
        await provideTestInstance({ directory: tmp.path, fn: () => BackgroundProcess.stop(info.id) })
      }
    }),
  )

  it.instance(
    "bounds and secures persistent process artifacts",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "bounded.mjs",
            `console.log("READY")
await Bun.sleep(1_000)
await new Promise((resolve) => process.stdout.write("x".repeat(1_100 * 1024) + "FINAL", resolve))
setInterval(() => {}, 1_000)
`,
          ),
        )
        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: test.directory,
            lifetime: "persistent",
            ready: { pattern: "READY", timeout: 15_000 },
          }),
        )
        const files = artifacts(test.directory, info.id)

        try {
          expect(info.status).toBe("ready")
          yield* Effect.promise(() =>
            until(
              async () => (await Bun.file(files.log).text()).includes("FINAL"),
              "bounded output did not flush",
              15_000,
            ),
          )
          yield* Effect.promise(() => Bun.sleep(600))
          const current = yield* Effect.promise(() => BackgroundProcess.get(info.id))
          expect(current?.output).toContain("FINAL")
          expect(Buffer.byteLength(current?.output ?? "")).toBeLessThanOrEqual(200 * 1024)

          const log = yield* Effect.promise(() => fs.stat(files.log))
          expect(log.size).toBeLessThanOrEqual(1024 * 1024)
          const manifest = yield* Effect.promise(() => Bun.file(files.manifest).json())
          expect(manifest.info.output).toBe("")
          expect(manifest.info.ports).toEqual([])
          if (process.platform !== "win32") {
            expect(log.mode & 0o777).toBe(0o600)
            expect((yield* Effect.promise(() => fs.stat(files.manifest))).mode & 0o777).toBe(0o600)
            expect((yield* Effect.promise(() => fs.stat(path.dirname(files.log)))).mode & 0o777).toBe(0o700)
            expect((yield* Effect.promise(() => fs.stat(path.dirname(files.manifest)))).mode & 0o777).toBe(0o700)
          }
          yield* Effect.promise(() => Bun.sleep(300))
          const before = yield* Effect.promise(() => fs.stat(files.manifest))
          yield* Effect.promise(() => Bun.sleep(1_200))
          const after = yield* Effect.promise(() => fs.stat(files.manifest))
          expect(after.mtimeMs).toBe(before.mtimeMs)
        } finally {
          yield* Effect.promise(() => BackgroundProcess.stop(info.id))
        }
        expect(yield* Effect.promise(() => Bun.file(files.manifest).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(files.log).exists())).toBe(false)
      }),
    35_000,
  )

  it.instance("rejects a persistent manifest for an unrelated live process", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()
      const command = yield* Effect.promise(() =>
        script(
          test.directory,
          "owned.mjs",
          `console.log("ready")
setInterval(() => {}, 1_000)
`,
        ),
      )
      const info = yield* Effect.promise(() =>
        BackgroundProcess.start({
          sessionID,
          command,
          cwd: test.directory,
          lifetime: "persistent",
          ready: { pattern: "ready", timeout: 15_000 },
        }),
      )
      const files = artifacts(test.directory, info.id)
      const source = yield* Effect.promise(() => Bun.file(files.manifest).json())
      const unrelated = yield* Effect.promise(async () => {
        const command = await script(test.directory, "unrelated.mjs", "setInterval(() => {}, 1_000)\n")
        const sh = Shell.acceptable()
        return spawn(sh, Shell.args(sh, command, test.directory), {
          cwd: test.directory,
          detached: process.platform !== "win32",
          stdio: "ignore",
          windowsHide: true,
        })
      })
      const fake = BackgroundProcess.ID.ascending("bgp_unrelated")
      const forged = structuredClone(source)
      forged.info.id = fake
      forged.info.pid = unrelated.pid
      const target = artifacts(test.directory, fake)
      yield* Effect.promise(() => fs.writeFile(target.manifest, JSON.stringify(forged), { mode: 0o600 }))
      yield* Effect.promise(() => fs.writeFile(target.log, "", { mode: 0o600 }))

      try {
        expect(yield* Effect.promise(() => BackgroundProcess.stop(fake))).toBeUndefined()
        expect(alive(unrelated.pid)).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(target.manifest).exists())).toBe(false)
      } finally {
        yield* Effect.promise(async () => {
          const exited =
            unrelated.exitCode !== null || unrelated.signalCode !== null ? undefined : once(unrelated, "exit")
          if (unrelated.pid && alive(unrelated.pid)) {
            if (process.platform === "win32") unrelated.kill("SIGKILL")
            else process.kill(-unrelated.pid, "SIGKILL")
          }
          await exited
        })
        yield* Effect.promise(() => BackgroundProcess.stop(info.id))
      }
    }),
  )

  it.instance(
    "keeps persistent descendants manageable after the leader exits",
    () =>
      Effect.gen(function* () {
        if (!["linux", "darwin", "win32"].includes(process.platform)) return
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const child = path.join(test.directory, "descendant.mjs")
        const ready = path.join(test.directory, "descendant-ready")
        yield* Effect.promise(() =>
          Bun.write(
            child,
            `import { writeFileSync } from "fs"
writeFileSync(${JSON.stringify(ready)}, "ready")
setInterval(() => {}, 1_000)
`,
          ),
        )
        // Use Node so child process-group inheritance is consistent across Bun versions.
        const exec = "node"
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "leader.cjs",
            `const { spawn } = require("child_process")
const { existsSync } = require("fs")
console.log("leader:" + process.pid)
const child = spawn(process.execPath, [${JSON.stringify(child)}], {
  stdio: "ignore",
  detached: process.platform === "win32",
  windowsHide: true,
})
child.unref()
const timer = setInterval(() => {
  if (!existsSync(${JSON.stringify(ready)})) return
  clearInterval(timer)
  console.log("child:" + child.pid)
}, 10)
if (process.platform === "win32") setTimeout(() => {}, 5_000)
`,
            exec,
          ),
        )
        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID,
            command,
            cwd: test.directory,
            lifetime: "persistent",
            ready: { pattern: "child:", timeout: 15_000 },
          }),
        )
        const leader = Number(info.output.match(/leader:(\d+)/)?.[1])
        const pid = Number(info.output.match(/child:(\d+)/)?.[1])
        const runner = info.pid
        try {
          expect(info.status).toBe("ready")
          expect(leader).toBeGreaterThan(0)
          expect(pid).toBeGreaterThan(0)
          yield* Effect.promise(() => until(() => !alive(leader), "persistent command leader did not exit", 10_000))
          if (process.platform === "win32") {
            // Assert after the runner's one-second ancestry grace window has elapsed.
            yield* Effect.promise(() => Bun.sleep(2_000))
            expect(alive(runner)).toBe(true)
          }
          if (process.platform !== "win32") {
            yield* Effect.promise(() => until(() => !alive(runner), "persistent runner did not exit"))
          }
          const current = yield* Effect.promise(() => BackgroundProcess.get(info.id))
          if (!current) throw new Error("Persistent process disappeared while its descendant was running")
          expect(["running", "ready"]).toContain(current.status)
          expect(alive(pid)).toBe(true)
          yield* Effect.promise(() => BackgroundProcess.stop(info.id))
          yield* Effect.promise(() => until(() => !alive(pid), "persistent descendant was not terminated"))
        } finally {
          yield* Effect.promise(async () => {
            await Promise.allSettled([BackgroundProcess.stop(info.id)])
            for (const item of [pid, runner]) {
              if (!item || !alive(item)) continue
              try {
                process.kill(item, "SIGKILL")
              } catch (err) {
                if (alive(item)) throw err
              }
            }
          })
        }
      }),
    // Windows process-tree ownership uses PowerShell/CIM probes and intentionally
    // keeps the leader alive for five seconds, so it needs a larger outer budget.
    process.platform === "win32" ? 60_000 : 30_000,
  )

  it.instance("rejects invalid readiness patterns before launching", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessionID = SessionID.descending()

      const err = yield* Effect.promise(async () => {
        try {
          await BackgroundProcess.start({
            sessionID,
            command: "printf 'ready\n'",
            cwd: test.directory,
            ready: { pattern: "[", timeout: 1_000 },
          })
        } catch (err) {
          return err
        }
      })

      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain("Invalid ready pattern")

      const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
      expect(list).toEqual([])
    }),
  )
})
