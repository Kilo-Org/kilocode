import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { Schema } from "effect"
import PeriodicPlugin, { FlowsDialog } from "../src/tui"

const color = RGBA.fromInts(200, 200, 200, 255)
const selectedText = RGBA.fromInts(20, 20, 20, 255)
const selectedBackground = RGBA.fromInts(255, 221, 0, 255)
const errorText = RGBA.fromInts(220, 30, 30, 255)
const stateful = {
  base: color,
  hovered: color,
  focused: color,
  selected: color,
  disabled: color,
  state: () => color,
}
const selectedAction = { ...stateful, focused: selectedText }
const selectedFormfield = { ...stateful, focused: selectedBackground }
const selectedActionBackground = { ...stateful, focused: selectedBackground }
const theme = {
  text: {
    base: color,
    muted: color,
    faint: color,
    action: { primary: selectedAction, secondary: stateful },
    formfield: selectedFormfield,
    feedback: {
      success: { base: color, muted: color },
      error: { base: errorText, muted: color },
      warning: { base: color, muted: color },
      info: { base: color, muted: color },
    },
  },
  background: { action: { primary: selectedActionBackground, secondary: stateful } },
  surface() {
    return theme
  },
} as unknown as Plugin.Context["theme"]

function context(
  commands: KeymapCommand[],
  destinations: unknown[] = [],
  focused: string[] = [],
  cleared: boolean[] = [],
  focus = true,
) {
  return {
    client: undefined,
    data: { location: { default: () => ({ directory: "/workspace" }) } },
    renderer: { requestAnimationFrame: (callback: () => void) => callback() },
    theme,
    keymap: {
      layer(factory: () => { commands: readonly KeymapCommand[] }) {
        commands.push(...factory().commands)
      },
    },
    ui: {
      dialog: { clear: () => cleared.push(true) },
      router: { navigate: (destination: unknown) => destinations.push(destination) },
      tabs: {
        focus(sessionID: string) {
          if (!focus) return false
          focused.push(sessionID)
          return true
        },
      },
    },
  } as unknown as Pick<Plugin.Context, "client" | "data" | "keymap" | "renderer" | "theme" | "ui">
}

const flow = (input: {
  id: string
  name: string
  status: KiloFlowRpc.Status
  managed?: boolean
  next?: number
  error?: string
  run?: KiloFlowRpc.RunStatus
  prompt?: string
  permissions?: KiloFlowRpc.PermissionGrant[]
}) => {
  const managed = input.managed ?? input.run !== undefined
  return Schema.decodeUnknownSync(KiloFlowRpc.Info)({
    reference: managed
      ? { type: "managed", flowID: input.id }
      : { type: "native-schedule", scheduleID: input.id },
    name: input.name,
    authority: { type: "local" },
    trigger: { type: "time", when: { type: "every", every: "1 hour" }, timezone: "UTC" },
    execution: managed
      ? { type: "local", mode: "fresh", sourceSessionID: "ses_tui", worktree: "reuse" }
      : { type: "local", mode: "session-reuse", sessionID: "ses_tui" },
    context: {
      directory: "/workspace",
      projectID: "proj_tui",
      sessionID: "ses_tui",
      model: { providerID: "kilo", id: "test-model" },
      agent: "build",
    },
    prompt: input.prompt ?? "Run it",
    ...(managed
      ? { permissions: input.permissions ?? [{ action: "shell", resource: "taskctl *" }] }
      : {}),
    status: input.status,
    ...(input.next === undefined ? {} : { nextRunAt: input.next }),
    ...(input.run ? { latestRun: run(input.id, input.run) } : {}),
    health: input.error ? { status: "error", message: input.error } : { status: "healthy" },
    time: { created: 1, updated: 2 },
  })
}

const run = (flowID: string, status: KiloFlowRpc.RunStatus = "starting") =>
  Schema.decodeUnknownSync(KiloFlowRpc.Run)({
    version: 1,
    id: "flr_tui",
    flowID,
    status,
    worktree: "reuse",
    sessionID: "ses_flow_run",
    directory: "/workspace/run",
    time: { created: 10, updated: 20, started: 10, ...(status === "running" ? {} : { completed: 20 }) },
  })

const output = (flows: readonly KiloFlowRpc.Info[] = [], warnings: readonly KiloFlowRpc.Warning[] = []) => ({
  flows: [...flows],
  warnings: [...warnings],
  observedAt: 1,
})

function command(commands: readonly KeymapCommand[], bind: string) {
  return commands.find((entry) => entry.bind === bind)!
}

function enabled(value: KeymapCommand) {
  if (typeof value.enabled === "function") return value.enabled()
  return value.enabled !== false
}

test("registers /periodic as a large popup", async () => {
  const commands: KeymapCommand[] = []
  let renderSlot: (() => unknown) | undefined
  let renderDialog: (() => unknown) | undefined
  let closeDialog: (() => void) | undefined
  let dialogOptions: unknown
  let cleared = 0
  let unregistered = 0
  const cleanup = await PeriodicPlugin.setup({
    keymap: {
      layer(factory: () => { commands: readonly KeymapCommand[] }) {
        commands.push(...factory().commands)
      },
    },
    ui: {
      dialog: {
        show(render: () => unknown, onClose?: () => void) {
          closeDialog?.()
          renderDialog = render
          closeDialog = onClose
        },
        set(options: unknown) {
          dialogOptions = options
        },
        clear() {
          cleared++
          closeDialog?.()
        },
      },
      slot(claim: { render: () => unknown }) {
        renderSlot = claim.render
        return () => unregistered++
      },
    },
  } as unknown as Plugin.Context)
  renderSlot?.()
  const open = commands.find((entry) => entry.id === "periodic.open")
  expect(open?.slash).toEqual({ name: "periodic" })
  open?.run()
  open?.run()
  expect(renderDialog).toBeFunction()
  expect(dialogOptions).toEqual({ size: "large" })
  if (typeof cleanup === "function") await cleanup()
  expect(cleared).toBe(1)
  expect(unregistered).toBe(1)
})

test("shows loading, empty, and sorted single-line summaries", async () => {
  const pending = Promise.withResolvers<KiloFlowRpc.ListOutput>()
  const commands: KeymapCommand[] = []
  const app = await testRender(() => <FlowsDialog context={context(commands)} load={() => pending.promise} />, {
    width: 88,
    height: 24,
  })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Loading local flows"))
    pending.resolve(output())
    await app.waitForFrame((frame) => frame.includes("No periodic flows"))
    expect(commands.map((entry) => entry.bind)).toEqual([
      "escape",
      "ctrl+r",
      "up,k",
      "down,j",
      "pageup",
      "pagedown",
      "return",
      "r",
      "e",
      "d",
      "y",
      "n",
      "v",
    ])
  } finally {
    app.renderer.destroy()
  }

  const populated = await testRender(
    () => (
      <FlowsDialog
        context={context([])}
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
    { width: 88, height: 24 },
  )
  try {
    populated.renderer.start()
    await populated.waitForFrame((frame) => frame.includes("Completed"))
    const frame = populated.captureCharFrame()
    const names = ["Broken", "Earlier", "Later", "Paused", "Completed"]
    expect(names.map((name) => frame.indexOf(name))).toEqual(
      [...names.map((name) => frame.indexOf(name))].toSorted((left, right) => left - right),
    )
    expect(frame).toContain("Every 1 hour")
    expect(frame).toContain("Unmanaged")
    expect(frame).toContain("5 tasks")
    expect(frame).not.toContain("/workspace")
    const selected = populated
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("Broken"))
    expect(selected?.fg.equals(selectedText)).toBeTrue()
    expect(selected?.fg.equals(selected?.bg)).toBeFalse()
  } finally {
    populated.renderer.destroy()
  }
})

test("fits short terminals, scrolls details, and restores the selected row", async () => {
  const commands: KeymapCommand[] = []
  const flows = Array.from({ length: 20 }, (_, index) =>
    flow({
      id: `flw_${index.toString().padStart(2, "0")}`,
      name: `Flow ${index.toString().padStart(2, "0")}`,
      status: "active",
      managed: true,
      ...(index === 16
        ? {
            prompt: "Inspect every item in this deliberately long unattended task. ".repeat(10),
            error: "Health marker at the end of details",
          }
        : {}),
    }),
  )
  const app = await testRender(
    () => <FlowsDialog context={context(commands)} load={() => Promise.resolve(output(flows))} />,
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("20 tasks"))
    for (let index = 0; index < 16; index++) command(commands, "down,j").run()
    await app.waitForFrame((frame) => frame.includes("› Flow 16"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Flow 16") && frame.includes("Run now"))
    expect(app.captureCharFrame()).not.toContain("Health marker at the end of details")
    command(commands, "pagedown").run()
    await app.waitForFrame((frame) => frame.includes("Health marker at the end of details"))
    command(commands, "escape").run()
    await app.waitForFrame((frame) => frame.includes("› Flow 16") && frame.includes("20 tasks"))
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the clicked Flow selected when returning from details", async () => {
  const commands: KeymapCommand[] = []
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() =>
          Promise.resolve(
            output([
              flow({ id: "flw_first", name: "First", status: "active", managed: true }),
              flow({ id: "flw_second", name: "Second", status: "active", managed: true }),
            ]),
          )
        }
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("First") && frame.includes("Second"))
    const rows = app.captureCharFrame().split("\n")
    const row = rows.findIndex((line) => line.includes("Second"))
    await app.mockMouse.click(rows[row]!.indexOf("Second"), row)
    await app.waitForFrame((frame) => frame.includes("Periodic / Second"))
    command(commands, "escape").run()
    await app.waitForFrame((frame) => frame.includes("› Second"))
  } finally {
    app.renderer.destroy()
  }
})

test("truncates long summaries and titles without hiding dialog controls", async () => {
  const commands: KeymapCommand[] = []
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() =>
          Promise.resolve(
            output([
              flow({
                id: "flw_long",
                name: "A very long periodic Flow name that cannot fit inside a narrow terminal",
                status: "active",
                managed: true,
              }),
            ]),
          )
        }
      />
    ),
    { width: 40, height: 20 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("esc close") && frame.includes("1 task"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("esc back") && frame.includes("Run now"))
  } finally {
    app.renderer.destroy()
  }
})

test("opens Flow details and focuses the latest run Session", async () => {
  const commands: KeymapCommand[] = []
  const destinations: unknown[] = []
  const focused: string[] = []
  const cleared: boolean[] = []
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands, destinations, focused, cleared)}
        load={() =>
          Promise.resolve(
            output([flow({ id: "flw_manual", name: "Manual", status: "paused", run: "running" })]),
          )
        }
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Manual") && frame.includes("1 task"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Manual") && frame.includes("View session"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("Status")
    expect(frame).toContain("Paused")
    expect(frame).toContain("Prompt")
    expect(frame).toContain("Run it")
    expect(frame).toContain("Permissions")
    expect(frame).toContain("shell taskctl *")
    expect(frame).toContain("Run location")
    expect(frame).toContain("/workspace/run")
    command(commands, "v").run()
    expect(cleared).toEqual([true])
    expect(focused).toEqual(["ses_flow_run"])
    expect(destinations).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("falls back to Session navigation when tabs are unavailable", async () => {
  const commands: KeymapCommand[] = []
  const destinations: unknown[] = []
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands, destinations, [], [], false)}
        load={() =>
          Promise.resolve(
            output([flow({ id: "flw_navigation", name: "Navigation", status: "active", run: "succeeded" })]),
          )
        }
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Navigation"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("View session"))
    command(commands, "v").run()
    expect(destinations).toEqual([{ type: "session", sessionID: "ses_flow_run" }])
  } finally {
    app.renderer.destroy()
  }
})

test("runs, disables, enables, and deletes a managed Flow from its details", async () => {
  const commands: KeymapCommand[] = []
  const calls: string[] = []
  const active = flow({ id: "flw_control", name: "Controlled", status: "active", managed: true })
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() => Promise.resolve(output([active]))}
        control={(method) => {
          calls.push(method)
          if (method === "remove") return Promise.resolve(undefined)
          return Promise.resolve({ ...active, status: method === "pause" ? "paused" : "active" })
        }}
        run={() => {
          calls.push("run")
          return Promise.resolve(run("flw_control"))
        }}
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Controlled"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Disable") && frame.includes("Run now"))
    command(commands, "d").run()
    await app.waitForFrame((frame) => frame.includes("Delete Controlled?"))
    expect(command(commands, "n").run()).toBeUndefined()
    await app.waitForFrame((frame) => frame.includes("Periodic / Controlled") && !frame.includes("Delete Controlled?"))
    command(commands, "d").run()
    await app.waitForFrame((frame) => frame.includes("Delete Controlled?"))
    command(commands, "escape").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Controlled") && !frame.includes("Delete Controlled?"))
    command(commands, "e").run()
    await app.waitForFrame((frame) => frame.includes("Disabled Controlled"))
    command(commands, "e").run()
    await app.waitForFrame((frame) => frame.includes("Enabled Controlled"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("Starting Controlled"))
    command(commands, "d").run()
    await app.waitForFrame((frame) => frame.includes("Delete Controlled?") && frame.includes("retained run records"))
    command(commands, "y").run()
    await app.waitForFrame((frame) => frame.includes("Deleted Controlled") && frame.includes("No periodic flows"))
    expect(calls).toEqual(["pause", "resume", "run", "remove"])
  } finally {
    app.renderer.destroy()
  }
})

test("recovers when a Flow disappears during delete confirmation", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() => {
          calls++
          return Promise.resolve(
            calls === 1
              ? output([flow({ id: "flw_removed", name: "Removed elsewhere", status: "active", managed: true })])
              : output(),
          )
        }}
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Removed elsewhere"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Removed elsewhere"))
    command(commands, "d").run()
    await app.waitForFrame((frame) => frame.includes("Delete Removed elsewhere?"))
    command(commands, "ctrl+r").run()
    await app.waitForFrame((frame) => frame.includes("No periodic flows"))
    expect(enabled(command(commands, "r"))).toBeTrue()
    expect(enabled(command(commands, "y"))).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test("shows failed and rejected run attempts as errors", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const active = flow({ id: "flw_failure", name: "Failure", status: "active", managed: true })
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() => Promise.resolve(output([active]))}
        run={() => {
          calls++
          if (calls === 1) return Promise.resolve(run("flw_failure", "failed"))
          return Promise.reject(new Error("executor unavailable"))
        }}
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Failure"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Run now"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("Failed Failure"))
    const failed = app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("Failed Failure"))
    expect(failed?.fg.equals(errorText)).toBeTrue()
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("Run failed: executor unavailable"))
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the latest real run when a manual run is skipped", async () => {
  const commands: KeymapCommand[] = []
  const focused: string[] = []
  const active = flow({ id: "flw_busy", name: "Busy", status: "active", run: "running" })
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands, [], focused)}
        load={() => Promise.resolve(output([active]))}
        run={() =>
          Promise.resolve(
            Schema.decodeUnknownSync(KiloFlowRpc.Run)({
              version: 1,
              id: "flr_skipped",
              flowID: "flw_busy",
              status: "skipped",
              worktree: "reuse",
              time: { created: 30, updated: 30, completed: 30 },
            }),
          )
        }
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Busy"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Latest run") && frame.includes("Running"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("Skipped Busy: another run is active."))
    const frame = app.captureCharFrame()
    expect(frame).toContain("Running")
    expect(frame).toContain("View session")
    expect(frame).not.toContain("Latest run Skipped")
    command(commands, "v").run()
    expect(focused).toEqual(["ses_flow_run"])
  } finally {
    app.renderer.destroy()
  }
})

test("keeps unmanaged schedules read-only in details", async () => {
  const commands: KeymapCommand[] = []
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() => Promise.resolve(output([flow({ id: "sch_native", name: "Native", status: "active" })]))}
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Native"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Unmanaged schedules are read-only"))
    expect(enabled(command(commands, "r"))).toBeFalse()
    expect(enabled(command(commands, "e"))).toBeFalse()
    expect(enabled(command(commands, "d"))).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the last successful result visible and marks it stale after refresh fails", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() => {
          calls++
          if (calls === 1)
            return Promise.resolve(output([flow({ id: "sch_kept", name: "Kept flow", status: "active" })]))
          return Promise.reject(new Error("server unavailable"))
        }}
      />
    ),
    { width: 88, height: 20 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Kept flow"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("Stale") && frame.includes("server unavailable"))
    expect(app.captureCharFrame()).toContain("Kept flow")
  } finally {
    app.renderer.destroy()
  }
})

test("shows a retryable initial error and aborts an outstanding request on unmount", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const app = await testRender(
    () => (
      <FlowsDialog
        context={context(commands)}
        load={() => {
          calls++
          return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(output())
        }}
      />
    ),
    { width: 88, height: 20 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Couldn’t load flows") && frame.includes("Press r to retry"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("No periodic flows"))
  } finally {
    app.renderer.destroy()
  }

  const pending = Promise.withResolvers<KiloFlowRpc.ListOutput>()
  let signal: AbortSignal | undefined
  let requests = 0
  const cleanupCommands: KeymapCommand[] = []
  const cleanup = await testRender(
    () => (
      <FlowsDialog
        context={context(cleanupCommands)}
        pollMilliseconds={5}
        load={(current) => {
          requests++
          signal = current
          return pending.promise
        }}
      />
    ),
    { width: 88, height: 20 },
  )
  cleanup.renderer.start()
  await cleanup.waitForFrame((frame) => frame.includes("Loading local flows"))
  command(cleanupCommands, "r").run()
  await Bun.sleep(15)
  expect(requests).toBe(1)
  cleanup.renderer.destroy()
  expect(signal?.aborted).toBe(true)
})
