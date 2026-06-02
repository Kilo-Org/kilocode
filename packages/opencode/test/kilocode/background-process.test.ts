import { describe, expect } from "bun:test"
import { Bus } from "@/bus"
import { BackgroundProcess } from "@/kilocode/background-process"
import { SessionID } from "@/session/schema"
import { Shell } from "@/shell/shell"
import { Effect } from "effect"
import path from "path"
import { TestInstance } from "../fixture/fixture"
import { it } from "../lib/effect"

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function script(dir: string, name: string, source: string) {
  const file = path.join(dir, name)
  await Bun.write(file, source)
  const bin = quote(process.execPath)
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
