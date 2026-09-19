import { describe, expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { BackgroundProcess } from "@/kilocode/background-process"
import { BackgroundProcessTool } from "@/kilocode/tool/background-process"
import { MessageID, SessionID } from "@/session/schema"
import { Shell } from "@opencode-ai/core/shell"
import * as Truncate from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { Effect, Layer } from "effect"
import path from "path"
import { TestInstance } from "../fixture/fixture"
import { it } from "../lib/effect"

// The product picks its command shell from $SHELL. Pin it so the streaming path
// runs against a real shell on every host instead of a wrapper that buffers.
if (process.platform !== "win32") process.env.SHELL = "/bin/sh"

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

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function read(pidfile: string) {
  const value = Number(await Bun.file(pidfile).text().catch(() => ""))
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Reap the grandchild a test spawned with inherited stdio. `stopSession` only
 * signals a non-terminal leader, so an orphan whose parent already exited is
 * left running; the pid file is written before the leader exits, so it is
 * readable here even when the monitor call fails.
 */
async function reap(pidfile: string) {
  const target = await read(pidfile)
  if (!target || !alive(target)) return
  try {
    process.kill(target, "SIGKILL")
  } catch (err) {
    if (alive(target)) throw err
  }
}

async function gone(target: number) {
  const end = Date.now() + 2_000
  while (Date.now() < end) {
    if (!alive(target)) return true
    await Bun.sleep(50)
  }
  return false
}

const agentInfo = {
  name: "code",
  mode: "primary",
  options: {},
  permission: {},
} as Agent.Info

const agents = Agent.Service.of({
  get: () => Effect.succeed(agentInfo),
  list: () => Effect.succeed([agentInfo]),
  defaultInfo: () => Effect.succeed(agentInfo),
  defaultAgent: () => Effect.succeed("code"),
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text as string, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

/** Build the tool against stub Agent/Truncate services; the instance context comes from `it.instance`. */
function build() {
  return Effect.gen(function* () {
    const info = yield* BackgroundProcessTool.pipe(
      Effect.provide(Layer.mergeAll(Layer.succeed(Agent.Service, agents), Layer.succeed(Truncate.Service, truncate))),
    )
    return yield* info.init()
  })
}

function context(sessionID: SessionID) {
  const meta: Array<Record<string, unknown>> = []
  const ctx: Tool.Context = {
    sessionID,
    messageID: MessageID.make("msg_monitor"),
    callID: "call_monitor",
    agent: "code",
    abort: new AbortController().signal,
    messages: [],
    metadata: (input) => Effect.sync(() => void meta.push(input.metadata ?? {})),
    ask: () => Effect.void,
  }
  return { ctx, meta }
}

describe("background_process monitor", () => {
  it.instance(
    "returns the output of a process that exits",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(test.directory, "monitor-exit.mjs", `console.log("one")\nconsole.log("two")\nconsole.log("three")\n`),
        )
        const tool = yield* build()
        const { ctx, meta } = context(sessionID)

        try {
          const result = yield* tool.execute({ action: "monitor", command }, ctx)

          expect(result.metadata.reason).toBe("exit")
          expect(result.metadata.status).toBe("exited")
          expect(result.metadata.lines).toBe(3)
          expect(result.output).toContain("one")
          expect(result.output).toContain("two")
          expect(result.output).toContain("three")
          expect(result.output).toContain("monitor stopped")
          expect(result.output).toContain(result.metadata.processID ?? "missing")
          expect(meta.some((item) => String(item["output"]).includes("three"))).toBe(true)
        } finally {
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "finalizes when a descendant holds the stdio pipes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        // The command hands its stdio to a grandchild that outlives it, so the
        // pipes never close. `status`/`monitor` must still observe the exit
        // instead of reporting the dead parent as running until the cap. The
        // grandchild records its pid because `stopSession` drops the terminal
        // record without signalling the inherited pipes, so the test reaps it.
        const pidfile = path.join(test.directory, "monitor-orphan.pid")
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "monitor-orphan.mjs",
            `import { spawn } from "node:child_process"\n` +
              `import { writeFileSync } from "node:fs"\n` +
              `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" })\n` +
              `writeFileSync(${JSON.stringify(pidfile)}, String(child.pid))\n` +
              `child.unref()\n` +
              `console.log("launched")\n`,
          ),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)

        try {
          const result = yield* tool.execute({ action: "monitor", command, timeout: 5000 }, ctx)

          expect(result.metadata.reason).toBe("exit")
          expect(result.metadata.status).toBe("exited")
          expect(result.output).toContain("launched")
        } finally {
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
          yield* Effect.promise(() => reap(pidfile))
        }
        // `stopSession` drops the terminal record without signalling the
        // inherited pipes, so the reap above is what stops the orphan.
        const orphan = yield* Effect.promise(() => read(pidfile))
        if (!orphan) throw new Error("the orphan did not record its pid")
        expect(yield* Effect.promise(() => gone(orphan))).toBe(true)
      }),
    30_000,
  )

  it.instance(
    "caps captured lines and leaves the process running",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "monitor-lines.mjs",
            `for (let i = 1; i <= 250; i++) console.log("line " + i)\nsetInterval(() => {}, 1000)\n`,
          ),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)
        let id: BackgroundProcess.ID | undefined

        try {
          const result = yield* tool.execute({ action: "monitor", command }, ctx)
          id = result.metadata.processID
          if (!id) throw new Error("monitor did not return a process id")

          expect(result.metadata.reason).toBe("lines")
          expect(result.metadata.lines).toBe(200)
          expect(result.output).toContain("line 250")
          expect(result.output).toContain("line 51")
          expect(result.output).not.toContain("line 50\n")
          expect(result.output).toContain("200-line cap")
          const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
          expect(list.map((item) => item.id)).toContain(id)
        } finally {
          const stopped = id
          if (stopped) yield* Effect.promise(() => BackgroundProcess.stop(stopped))
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "raises a sub-floor timeout to the wall-time floor",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(test.directory, "monitor-time.mjs", `console.log("started")\nsetInterval(() => {}, 1000)\n`),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)
        const start = Date.now()
        let id: BackgroundProcess.ID | undefined

        try {
          // `timeout` is clamped to 5_000..600_000 ms, so 1500 ms runs to the 5-second floor.
          const result = yield* tool.execute({ action: "monitor", command, timeout: 1500 }, ctx)
          const elapsed = Date.now() - start
          id = result.metadata.processID
          if (!id) throw new Error("monitor did not return a process id")

          expect(result.metadata.reason).toBe("time")
          expect(result.metadata.status).toBe("running")
          expect(result.output).toContain("started")
          expect(result.output).toContain("5000 ms wall-time cap")
          expect(elapsed).toBeGreaterThanOrEqual(4_500)
          const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
          expect(list.map((item) => item.id)).toContain(id)
        } finally {
          const stopped = id
          if (stopped) yield* Effect.promise(() => BackgroundProcess.stop(stopped))
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "surfaces a non-zero exit",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "monitor-fail.mjs",
            `console.log("compiling")\nconsole.error("boom: build failed")\nprocess.exit(2)\n`,
          ),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)

        try {
          const result = yield* tool.execute({ action: "monitor", command }, ctx)

          expect(result.metadata.reason).toBe("exit")
          expect(result.metadata.status).toBe("failed")
          expect(result.output).toContain("compiling")
          expect(result.output).toContain("boom: build failed")
        } finally {
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )
})
import { describe, expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { BackgroundProcess } from "@/kilocode/background-process"
import { BackgroundProcessTool } from "@/kilocode/tool/background-process"
import { MessageID, SessionID } from "@/session/schema"
import { Shell } from "@opencode-ai/core/shell"
import * as Truncate from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { Effect, Layer } from "effect"
import path from "path"
import { TestInstance } from "../fixture/fixture"
import { it } from "../lib/effect"

// The product picks its command shell from $SHELL. Pin it so the streaming path
// runs against a real shell on every host instead of a wrapper that buffers.
if (process.platform !== "win32") process.env.SHELL = "/bin/sh"

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

function alive(pid: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const agentInfo = {
  name: "code",
  mode: "primary",
  options: {},
  permission: {},
} as Agent.Info

const agents = Agent.Service.of({
  get: () => Effect.succeed(agentInfo),
  list: () => Effect.succeed([agentInfo]),
  defaultInfo: () => Effect.succeed(agentInfo),
  defaultAgent: () => Effect.succeed("code"),
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text as string, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

/** Build the tool against stub Agent/Truncate services; the instance context comes from `it.instance`. */
function build() {
  return Effect.gen(function* () {
    const info = yield* BackgroundProcessTool.pipe(
      Effect.provide(Layer.mergeAll(Layer.succeed(Agent.Service, agents), Layer.succeed(Truncate.Service, truncate))),
    )
    return yield* info.init()
  })
}

function context(sessionID: SessionID) {
  const meta: Array<Record<string, unknown>> = []
  const ctx: Tool.Context = {
    sessionID,
    messageID: MessageID.make("msg_monitor"),
    callID: "call_monitor",
    agent: "code",
    abort: new AbortController().signal,
    messages: [],
    metadata: (input) => Effect.sync(() => void meta.push(input.metadata ?? {})),
    ask: () => Effect.void,
  }
  return { ctx, meta }
}

describe("background_process monitor", () => {
  it.instance(
    "returns the output of a process that exits",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(test.directory, "monitor-exit.mjs", `console.log("one")\nconsole.log("two")\nconsole.log("three")\n`),
        )
        const tool = yield* build()
        const { ctx, meta } = context(sessionID)

        try {
          const result = yield* tool.execute({ action: "monitor", command }, ctx)

          expect(result.metadata.reason).toBe("exit")
          expect(result.metadata.status).toBe("exited")
          expect(result.metadata.lines).toBe(3)
          expect(result.output).toContain("one")
          expect(result.output).toContain("two")
          expect(result.output).toContain("three")
          expect(result.output).toContain("monitor stopped")
          expect(result.output).toContain(result.metadata.processID ?? "missing")
          expect(meta.some((item) => String(item["output"]).includes("three"))).toBe(true)
        } finally {
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "finalizes when a descendant holds the stdio pipes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        // The command hands its stdio to a grandchild that outlives it, so the
        // pipes never close. `status`/`monitor` must still observe the exit
        // instead of reporting the dead parent as running until the cap. The
        // grandchild records its pid because `stopSession` only terminates a
        // live process, so the test has to signal the terminal parent's
        // descendant itself or it would keep running past the test.
        const pidfile = path.join(test.directory, "monitor-orphan.pid")
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "monitor-orphan.mjs",
            `import { spawn } from "node:child_process"\n` +
              `import { writeFileSync } from "node:fs"\n` +
              `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" })\n` +
              `child.unref()\n` +
              `writeFileSync(${JSON.stringify(pidfile)}, String(child.pid))\n` +
              `console.log("launched")\n`,
          ),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)

        try {
          const result = yield* tool.execute({ action: "monitor", command, timeout: 5000 }, ctx)

          expect(result.metadata.reason).toBe("exit")
          expect(result.metadata.status).toBe("exited")
          expect(result.output).toContain("launched")
        } finally {
          yield* Effect.promise(async () => {
            const pid = Number((await Bun.file(pidfile).text().catch(() => "")).trim())
            if (alive(pid)) {
              try {
                process.kill(pid, "SIGKILL")
              } catch (err) {
                if (alive(pid)) throw err
              }
            }
          })
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "caps captured lines and leaves the process running",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "monitor-lines.mjs",
            `for (let i = 1; i <= 250; i++) console.log("line " + i)\nsetInterval(() => {}, 1000)\n`,
          ),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)
        let id: BackgroundProcess.ID | undefined

        try {
          const result = yield* tool.execute({ action: "monitor", command }, ctx)
          id = result.metadata.processID
          if (!id) throw new Error("monitor did not return a process id")

          expect(result.metadata.reason).toBe("lines")
          expect(result.metadata.lines).toBe(200)
          expect(result.output).toContain("line 250")
          expect(result.output).toContain("line 51")
          expect(result.output).not.toContain("line 50\n")
          expect(result.output).toContain("200-line cap")
          const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
          expect(list.map((item) => item.id)).toContain(id)
        } finally {
          const stopped = id
          if (stopped) yield* Effect.promise(() => BackgroundProcess.stop(stopped))
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "raises a sub-floor timeout to the wall-time floor",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(test.directory, "monitor-time.mjs", `console.log("started")\nsetInterval(() => {}, 1000)\n`),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)
        const start = Date.now()
        let id: BackgroundProcess.ID | undefined

        try {
          // `timeout` is clamped to 5_000..600_000 ms, so 1500 ms runs to the 5-second floor.
          const result = yield* tool.execute({ action: "monitor", command, timeout: 1500 }, ctx)
          const elapsed = Date.now() - start
          id = result.metadata.processID
          if (!id) throw new Error("monitor did not return a process id")

          expect(result.metadata.reason).toBe("time")
          expect(result.metadata.status).toBe("running")
          expect(result.output).toContain("started")
          expect(result.output).toContain("5000 ms wall-time cap")
          expect(elapsed).toBeGreaterThanOrEqual(4_500)
          const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID }))
          expect(list.map((item) => item.id)).toContain(id)
        } finally {
          const stopped = id
          if (stopped) yield* Effect.promise(() => BackgroundProcess.stop(stopped))
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )

  it.instance(
    "surfaces a non-zero exit",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = SessionID.descending()
        const command = yield* Effect.promise(() =>
          script(
            test.directory,
            "monitor-fail.mjs",
            `console.log("compiling")\nconsole.error("boom: build failed")\nprocess.exit(2)\n`,
          ),
        )
        const tool = yield* build()
        const { ctx } = context(sessionID)

        try {
          const result = yield* tool.execute({ action: "monitor", command }, ctx)

          expect(result.metadata.reason).toBe("exit")
          expect(result.metadata.status).toBe("failed")
          expect(result.output).toContain("compiling")
          expect(result.output).toContain("boom: build failed")
        } finally {
          yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID))
        }
      }),
    30_000,
  )
})
