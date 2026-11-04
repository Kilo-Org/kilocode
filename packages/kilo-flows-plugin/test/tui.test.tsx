import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin/tui"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import { testRender } from "@opentui/solid"
import { Schema } from "effect"
import PeriodicPlugin, { FlowsPage } from "../src/tui"

function context(commands: KeymapCommand[], destinations: unknown[] = [], focused: string[] = []) {
  return {
    client: undefined,
    data: { location: { default: () => ({ directory: "/workspace" }) } },
    renderer: { requestAnimationFrame: (callback: () => void) => callback() },
    keymap: {
      layer(factory: () => { commands: readonly KeymapCommand[] }) {
        commands.push(...factory().commands)
      },
    },
    ui: {
      dialog: { confirm: () => Promise.resolve(true) },
      router: { navigate: (destination: unknown) => destinations.push(destination) },
      tabs: {
        focus(sessionID: string) {
          focused.push(sessionID)
          return true
        },
      },
    },
  } as unknown as Pick<Plugin.Context, "client" | "data" | "keymap" | "renderer" | "ui">
}

const flow = (input: {
  id: string
  name: string
  status: KiloFlowRpc.Status
  next?: number
  error?: string
  run?: KiloFlowRpc.RunStatus
}) =>
  Schema.decodeUnknownSync(KiloFlowRpc.Info)({
    reference: input.run ? { type: "managed", flowID: input.id } : { type: "native-schedule", scheduleID: input.id },
    name: input.name,
    authority: { type: "local" },
    trigger: { type: "time", when: { type: "every", every: "1 hour" }, timezone: "UTC" },
    execution: { type: "local", mode: "session-reuse", sessionID: "ses_tui" },
    context: { directory: "/workspace", projectID: "proj_tui", sessionID: "ses_tui" },
    prompt: "Run it",
    ...(input.run ? { permissions: [{ action: "shell", resource: "git status *" }] } : {}),
    status: input.status,
    ...(input.next === undefined ? {} : { nextRunAt: input.next }),
    ...(input.run
      ? {
          latestRun: {
            version: 1,
            id: "flr_tui",
            flowID: input.id,
            status: input.run,
            worktree: "reuse",
            sessionID: "ses_flow_run",
            directory: "/workspace/run",
            time: { created: 10, updated: 20, started: 10, ...(input.run === "running" ? {} : { completed: 20 }) },
          },
        }
      : {}),
    health: input.error ? { status: "error", message: input.error } : { status: "healthy" },
    time: { created: 1, updated: 2 },
  })

const output = (flows: readonly KiloFlowRpc.Info[] = [], warnings: readonly KiloFlowRpc.Warning[] = []) => ({
  flows: [...flows],
  warnings: [...warnings],
  observedAt: 1,
})

test("registers /periodic and navigates to the periodic page", async () => {
  const commands: KeymapCommand[] = []
  const destinations: unknown[] = []
  let renderSlot: (() => unknown) | undefined
  const cleanup = await PeriodicPlugin.setup({
    keymap: {
      layer(factory: () => { commands: readonly KeymapCommand[] }) {
        commands.push(...factory().commands)
      },
    },
    ui: {
      dialog: { clear() {} },
      router: {
        current: () => ({ type: "home" }),
        navigate: (destination: unknown) => destinations.push(destination),
        register: () => () => {},
      },
      slot(claim: { render: () => unknown }) {
        renderSlot = claim.render
        return () => {}
      },
    },
  } as unknown as Plugin.Context)
  renderSlot?.()
  const command = commands.find((entry) => entry.id === "periodic.open")
  expect(command?.slash).toEqual({ name: "periodic" })
  command?.run()
  expect(destinations).toEqual([{ type: "plugin", name: "periodic" }])
  if (typeof cleanup === "function") await cleanup()
})

test("shows loading, empty, populated, and sorted states", async () => {
  const pending = Promise.withResolvers<KiloFlowRpc.ListOutput>()
  const commands: KeymapCommand[] = []
  const app = await testRender(
    () => <FlowsPage context={context(commands)} onClose={() => {}} load={() => pending.promise} />,
    { width: 100, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Loading local flows"))
    pending.resolve(output())
    await app.waitForFrame((frame) => frame.includes("No local flows"))
    expect(commands.map((command) => command.bind)).toEqual(["escape", "r", "up,k", "down,j", "return", "p", "d"])
  } finally {
    app.renderer.destroy()
  }

  const populated = await testRender(
    () => (
      <FlowsPage
        context={context([])}
        onClose={() => {}}
        load={() =>
          Promise.resolve(
            output([
              flow({ id: "sch_completed", name: "Completed", status: "completed" }),
              flow({ id: "sch_later", name: "Later", status: "active", next: 300 }),
              flow({ id: "sch_error", name: "Broken", status: "error", error: "Session missing" }),
              flow({ id: "sch_earlier", name: "Earlier", status: "active", next: 200 }),
              flow({ id: "sch_paused", name: "Paused", status: "paused" }),
            ]),
          )
        }
      />
    ),
    { width: 100, height: 30 },
  )
  try {
    populated.renderer.start()
    await populated.waitForFrame((frame) => frame.includes("Completed"))
    const frame = populated.captureCharFrame()
    expect(["Broken", "Earlier", "Later", "Paused", "Completed"].map((name) => frame.indexOf(name))).toEqual(
      [...["Broken", "Earlier", "Later", "Paused", "Completed"].map((name) => frame.indexOf(name))].toSorted(
        (left, right) => left - right,
      ),
    )
    expect(frame).toContain("[Local] [Unmanaged]")
    expect(frame).toContain("Every 1 hour")
    expect(frame).toContain("/workspace")
  } finally {
    populated.renderer.destroy()
  }
})

test("separates schedule state from run state and opens the latest run Session", async () => {
  const commands: KeymapCommand[] = []
  const destinations: unknown[] = []
  const focused: string[] = []
  const app = await testRender(
    () => (
      <FlowsPage
        context={context(commands, destinations, focused)}
        onClose={() => {}}
        load={() =>
          Promise.resolve(output([flow({ id: "flw_manual", name: "Manual", status: "paused", run: "running" })]))
        }
      />
    ),
    { width: 120, height: 20 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Latest run: Running"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("Schedule paused")
    expect(frame).toContain("session ses_flow_run")
    expect(frame).toContain("Run directory: /workspace/run")
    expect(frame).toContain("Permissions: shell git status *")
    commands.find((command) => command.bind === "return")!.run()
    expect(destinations).toEqual([{ type: "session", sessionID: "ses_flow_run" }])
    expect(focused).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the last successful result visible and marks it stale after refresh fails", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const app = await testRender(
    () => (
      <FlowsPage
        context={context(commands)}
        onClose={() => {}}
        load={() => {
          calls++
          if (calls === 1)
            return Promise.resolve(output([flow({ id: "sch_kept", name: "Kept flow", status: "active" })]))
          return Promise.reject(new Error("server unavailable"))
        }}
      />
    ),
    { width: 100, height: 20 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Kept flow"))
    commands.find((command) => command.bind === "r")!.run()
    await app.waitForFrame((frame) => frame.includes("Stale") && frame.includes("server unavailable"))
    expect(app.captureCharFrame()).toContain("Kept flow")
  } finally {
    app.renderer.destroy()
  }
})

test("pauses, resumes, and removes managed flows", async () => {
  const commands: KeymapCommand[] = []
  const calls: string[] = []
  const active = flow({ id: "flw_control", name: "Controlled", status: "active", run: "running" })
  const app = await testRender(
    () => (
      <FlowsPage
        context={context(commands)}
        onClose={() => {}}
        load={() => Promise.resolve(output([active]))}
        control={(method) => {
          calls.push(method)
          if (method === "remove") return Promise.resolve(undefined)
          return Promise.resolve({ ...active, status: method === "pause" ? "paused" : "active" })
        }}
      />
    ),
    { width: 120, height: 20 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Controlled"))
    commands.find((command) => command.bind === "p")!.run()
    await app.waitForFrame((frame) => frame.includes("Paused Controlled"))
    commands.find((command) => command.bind === "p")!.run()
    await app.waitForFrame((frame) => frame.includes("Resumed Controlled"))
    commands.find((command) => command.bind === "d")!.run()
    await app.waitForFrame((frame) => frame.includes("Removed Controlled"))
    expect(calls).toEqual(["pause", "resume", "remove"])
  } finally {
    app.renderer.destroy()
  }
})

test("shows a retryable initial error and aborts an outstanding request on unmount", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const app = await testRender(
    () => (
      <FlowsPage
        context={context(commands)}
        onClose={() => {}}
        load={() => {
          calls++
          return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(output())
        }}
      />
    ),
    { width: 80, height: 16 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Couldn’t load flows") && frame.includes("Press r to retry"))
    commands.find((command) => command.bind === "r")!.run()
    await app.waitForFrame((frame) => frame.includes("No local flows"))
  } finally {
    app.renderer.destroy()
  }

  const pending = Promise.withResolvers<KiloFlowRpc.ListOutput>()
  let signal: AbortSignal | undefined
  let requests = 0
  const cleanupCommands: KeymapCommand[] = []
  const cleanup = await testRender(
    () => (
      <FlowsPage
        context={context(cleanupCommands)}
        onClose={() => {}}
        pollMilliseconds={5}
        load={(current) => {
          requests++
          signal = current
          return pending.promise
        }}
      />
    ),
    { width: 80, height: 16 },
  )
  cleanup.renderer.start()
  await cleanup.waitForFrame((frame) => frame.includes("Loading local flows"))
  cleanupCommands.find((command) => command.bind === "r")!.run()
  await Bun.sleep(15)
  expect(requests).toBe(1)
  cleanup.renderer.destroy()
  expect(signal?.aborted).toBe(true)
})
