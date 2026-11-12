import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { Schema } from "effect"
import PeriodicPlugin, { FlowsDialog } from "../../src/kilocode/periodic"
import {
  changes,
  createFlow,
  deleteFlow,
  deriveName,
  editFlow,
  endsLabel,
  fromFlow,
  type PeriodicContext,
} from "../../src/kilocode/periodic-wizard"

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

const flow = (input: {
  id: string
  name: string
  status: KiloFlowRpc.Status
  managed?: boolean
  next?: number
  error?: string
  run?: KiloFlowRpc.RunStatus
  prompt?: string
  action?: "prompt" | "hook"
  worktree?: "reuse" | "new"
  permissions?: KiloFlowRpc.PermissionGrant[]
  ends?: { times?: number; after?: string; at?: string }
}) => {
  const managed = input.managed ?? input.run !== undefined
  return Schema.decodeUnknownSync(KiloFlowRpc.Info)({
    reference: managed
      ? { type: "managed", flowID: input.id }
      : { type: "native-schedule", scheduleID: input.id, ...(input.action ? { action: input.action } : {}) },
    name: input.name,
    authority: { type: "local" },
    trigger: { type: "time", when: { type: "every", every: "1 hour" }, timezone: "UTC" },
    execution: managed
      ? { type: "local", mode: "fresh", sourceSessionID: "ses_tui", worktree: input.worktree ?? "reuse" }
      : { type: "local", mode: "session-reuse", sessionID: "ses_tui" },
    context: {
      directory: "/workspace",
      projectID: "proj_tui",
      sessionID: "ses_tui",
      model: { providerID: "kilo", id: "test-model" },
      agent: "build",
    },
    prompt: input.prompt ?? "Run it",
    ...(managed ? { permissions: input.permissions ?? [{ action: "shell", resource: "taskctl *" }] } : {}),
    ...(input.ends ? { ends: input.ends } : {}),
    status: input.status,
    ...(input.next === undefined ? {} : { nextRunAt: input.next }),
    ...(input.run ? { latestRun: run(input.id, input.run) } : {}),
    health: input.error ? { status: "error", message: input.error } : { status: "healthy" },
    time: { created: 1, updated: 2 },
  })
}

const run = (flowID: string, status: KiloFlowRpc.RunStatus = "starting", id = "flr_tui", sessionID = "ses_flow_run") =>
  Schema.decodeUnknownSync(KiloFlowRpc.Run)({
    version: 1,
    id,
    flowID,
    status,
    worktree: "reuse",
    sessionID,
    directory: "/workspace/run",
    time: { created: 10, updated: 20, started: 10, ...(status === "running" ? {} : { completed: 20 }) },
  })

const output = (flows: readonly KiloFlowRpc.Info[] = [], warnings: readonly KiloFlowRpc.Warning[] = []) => ({
  flows: [...flows],
  warnings: [...warnings],
  observedAt: 1,
})

type Method = "list" | "create" | "update" | "runs" | "run" | "pause" | "resume" | "remove"
type Handlers = {
  list?: () => Promise<KiloFlowRpc.ListOutput>
  create?: (input: KiloFlowRpc.CreateInput) => Promise<KiloFlowRpc.Info>
  update?: (input: KiloFlowRpc.UpdateInput) => Promise<KiloFlowRpc.Info>
  runs?: (input: KiloFlowRpc.ControlInput) => Promise<KiloFlowRpc.RunsOutput>
  run?: (input: KiloFlowRpc.RunInput) => Promise<KiloFlowRpc.Run>
  pause?: (input: KiloFlowRpc.ControlInput) => Promise<KiloFlowRpc.Info>
  resume?: (input: KiloFlowRpc.ControlInput) => Promise<KiloFlowRpc.Info>
  remove?: (input: KiloFlowRpc.RemoveInput) => Promise<KiloFlowRpc.RemoveOutput>
}

/**
 * A structural plugin context with a typed fake for `client.rpc(KiloFlowRpc.Definition)`. The dialog and wizard only
 * read the fields set here, so one cast keeps the fixture small.
 */
function context(
  settings: {
    handlers?: Handlers
    commands?: KeymapCommand[]
    route?: { type: "session"; sessionID: string } | { type: "home" }
    script?: {
      prompts?: Record<string, string | string[]>
      selects?: Record<string, string | string[]>
      confirm?: boolean
    }
    onListCall?: (options: { signal?: AbortSignal } | undefined) => void
    message?: string
    wakeups?: (scheduleID: string) => string | undefined
  } = {},
) {
  const calls: { method: Method; input: unknown }[] = []
  const wakeupCalls: { method: "list" | "prompts"; input: unknown }[] = []
  const toasts: { variant: string; title?: string; message: string }[] = []
  const cleared: boolean[] = []
  const focused: string[] = []
  const destinations: unknown[] = []
  const alerts: { title?: string; message: string }[] = []
  const listeners = new Set<(event: { data: KiloFlowRpc.Changed }) => void>()
  const scripts = { prompts: {}, selects: {}, confirm: true, ...settings.script }
  const prompts: { title: string; value?: string; description?: string }[] = []
  const selects: { title: string; current?: string; options: readonly { title: string; value: unknown }[] }[] = []
  // A scripted answer is a value, or a queue the steps consume in order (a step asked again takes the next one).
  const answer = (answers: Record<string, string | string[]>, title: string) => {
    const scripted = Object.entries(answers).find(([key]) => title.includes(key))?.[1]
    if (!Array.isArray(scripted)) return scripted
    return scripted.shift()
  }
  const active = flow({ id: "flw_active", name: "Active", status: "active", managed: true })
  const handlers = settings.handlers ?? {}
  function record<Value>(method: Method, input: unknown, run: () => Promise<Value>) {
    calls.push({ method, input })
    return run()
  }
  const rpc = {
    list: (_input: unknown, options?: { signal?: AbortSignal }) => {
      settings.onListCall?.(options)
      return record("list", {}, handlers.list ?? (() => Promise.resolve(output([active]))))
    },
    create: (input: KiloFlowRpc.CreateInput) =>
      record("create", input, () => (handlers.create ?? (() => Promise.resolve(active)))(input)),
    update: (input: KiloFlowRpc.UpdateInput) => record("update", input, () => (handlers.update ?? (() => Promise.resolve(active)))(input)),
    runs: (input: KiloFlowRpc.ControlInput) =>
      record("runs", input, () => (handlers.runs ?? (() => Promise.resolve({ runs: [], warnings: [] })))(input)),
    run: (input: KiloFlowRpc.RunInput) =>
      record("run", input, () => (handlers.run ?? (() => Promise.resolve(run(active.reference.type === "managed" ? active.reference.flowID : "flw_active"))))(input)),
    pause: (input: KiloFlowRpc.ControlInput) =>
      record("pause", input, () => (handlers.pause ?? (() => Promise.resolve({ ...active, status: "paused" })))(input)),
    resume: (input: KiloFlowRpc.ControlInput) =>
      record("resume", input, () => (handlers.resume ?? (() => Promise.resolve(active)))(input)),
    remove: (input: KiloFlowRpc.RemoveInput) => record("remove", input, () => (handlers.remove ?? (() => Promise.resolve({})))(input)),
    events: {
      on(_name: string, handler: (event: { data: KiloFlowRpc.Changed }) => void) {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    },
  }
  const location = { directory: "/workspace" }
  const wakeupRpc = {
    list: (input: { sessionID: string }) => {
      wakeupCalls.push({ method: "list", input })
      return Promise.resolve({ wakeups: [] })
    },
    prompts: (input: { scheduleIDs: readonly string[] }) => {
      wakeupCalls.push({ method: "prompts", input })
      return Promise.resolve({
        prompts: Object.fromEntries(
          input.scheduleIDs.flatMap((id) => {
            const prompt = settings.wakeups?.(id)
            return prompt ? [[id, prompt] as const] : []
          }),
        ),
      })
    },
  }
  const fake = {
    client: {
      rpc: (definition: { id: string }) => (definition.id === "kilocode.wakeup" ? wakeupRpc : rpc),
      location: { get: () => Promise.resolve({ project: { id: "proj_tui" } }) },
      session: {
        list: () =>
          Promise.resolve({
            data: [
              {
                id: "ses_tui",
                title: "Weekend review",
                projectID: "proj_tui",
                time: { created: 1, updated: 2 },
              },
            ],
          }),
      },
    },
    data: {
      location: { default: () => location },
      on: () => () => undefined,
      session: {
        // A `ses_flow_*` Session is a Flow run, which the flow plugin marks with its metadata.
        get: (sessionID: string) => ({
          id: sessionID,
          title: "Weekend review",
          ...(sessionID.startsWith("ses_flow") ? { metadata: { "kilocode.flow": { flowID: "flw_edit" } } } : {}),
        }),
        message: {
          sync: () => Promise.resolve(),
          list: () => [
            { type: "user", id: "msg_1", text: "Review the weekend commits" },
            { type: "assistant", id: "msg_2" },
          ],
        },
      },
    },
    renderer: { requestAnimationFrame: (callback: () => void) => callback() },
    theme,
    keymap: {
      layer(factory: () => { commands: readonly KeymapCommand[] }) {
        settings.commands?.push(...factory().commands)
      },
    },
    ui: {
      dialog: {
        show() {},
        set() {},
        clear() {
          cleared.push(true)
        },
        prompt: (prompt: { title: string; value?: string; placeholder?: string; description?: string }) => {
          prompts.push(prompt)
          return Promise.resolve(answer(scripts.prompts, prompt.title) ?? prompt.value ?? "text")
        },
        select: (select: { title: string; current?: string; options: readonly { title: string; value: unknown }[] }) => {
          selects.push(select)
          return Promise.resolve(
            Object.keys(scripts.selects).some((key) => select.title.includes(key))
              ? answer(scripts.selects, select.title)
              : select.current,
          )
        },
        confirm: () => Promise.resolve(scripts.confirm),
        alert: (alert: { title?: string; message: string }) => {
          alerts.push(alert)
          return Promise.resolve()
        },
      },
      router: {
        current: () => settings.route ?? { type: "session", sessionID: "ses_tui" },
        navigate: (destination: { type: "session"; sessionID: string }) => destinations.push(destination),
      },
      tabs: {
        focus(sessionID: string) {
          focused.push(sessionID)
          return true
        },
      },
      toast: {
        show(toast: { variant: string; title?: string; message: string }) {
          toasts.push(toast)
        },
      },
      slot(claim: { render: () => unknown }) {
        settings.commands?.push()
        return () => undefined
      },
    },
  }
  return {
    context: fake as unknown as PeriodicContext,
    calls,
    wakeupCalls,
    toasts,
    cleared,
    focused,
    destinations,
    alerts,
    prompts,
    selects,
    emit: (event: KiloFlowRpc.Changed) => listeners.forEach((handler) => handler({ data: event })),
    methods: () => calls.map((call) => call.method),
  }
}

function command(commands: readonly KeymapCommand[], bind: string) {
  return commands.find((entry) => entry.bind === bind)!
}

function enabled(value: KeymapCommand) {
  if (typeof value.enabled === "function") return value.enabled()
  return value.enabled !== false
}

test("registers /periodic as a large popup with a palette entry", async () => {
  const commands: KeymapCommand[] = []
  let renderSlot: (() => unknown) | undefined
  let renderDialog: (() => unknown) | undefined
  let closeDialog: (() => void) | undefined
  let dialogOptions: unknown
  let cleared = 0
  let unregistered = 0
  const listed = Promise.withResolvers<KiloFlowRpc.ListOutput>()
  const base = context({ handlers: { list: () => listed.promise } }).context
  const cleanup = await PeriodicPlugin.setup({
    client: base.client,
    data: base.data,
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
  const open = commands.find((entry) => entry.id === "kilo.periodic")
  expect(open?.slash).toEqual({ name: "periodic" })
  expect(open?.palette).toBeTrue()
  // Suggested only once the launch project is known to have a managed Flow.
  const suggested = open?.suggested
  if (typeof suggested !== "function") throw new Error("Expected a reactive suggestion")
  expect(suggested()).toBeFalse()
  listed.resolve(output([flow({ id: "flw_live", name: "Live", status: "active", managed: true })]))
  await Bun.sleep(0)
  expect(suggested()).toBeTrue()
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
  const fake = context({ handlers: { list: () => pending.promise }, commands })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 24 })
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
      "n",
      "e",
      "space",
      "d",
      "w",
      "v",
    ])
  } finally {
    app.renderer.destroy()
  }

  const populated = await testRender(
    () => (
      <FlowsDialog
        context={
          context({
            handlers: {
              list: () =>
                Promise.resolve(
                  output([
                    flow({ id: "sch_completed", name: "Completed", status: "completed" }),
                    flow({ id: "sch_later", name: "Later", status: "active", next: 300 }),
                    flow({ id: "sch_error", name: "Broken", status: "error", error: "Session missing" }),
                    flow({ id: "sch_earlier", name: "Earlier", status: "active", next: 200 }),
                    flow({ id: "sch_paused", name: "Paused", status: "paused" }),
                  ]),
                ),
            },
          }).context
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
    expect(frame).toContain("schedule")
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
    () => (
      <FlowsDialog
        context={
          context({ commands, handlers: { list: () => Promise.resolve(output(flows)) } }).context
        }
      />
    ),
    { width: 88, height: 24 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("20 tasks"))
    for (let index = 0; index < 16; index++) command(commands, "down,j").run()
    await app.waitForFrame((frame) => frame.includes("› Flow 16"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Flow 16") && frame.includes("Disable"))
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
        context={
          context({
            commands,
            handlers: {
              list: () =>
                Promise.resolve(
                  output([
                    flow({ id: "flw_first", name: "First", status: "active", managed: true }),
                    flow({ id: "flw_second", name: "Second", status: "active", managed: true }),
                  ]),
                ),
            },
          }).context
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
        context={
          context({
            commands,
            handlers: {
              list: () =>
                Promise.resolve(
                  output([
                    flow({
                      id: "flw_long",
                      name: "A very long periodic Flow name that cannot fit inside a narrow terminal",
                      status: "active",
                      managed: true,
                    }),
                  ]),
                ),
            },
          }).context
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

test("opens Flow details with its history and focuses a run Session", async () => {
  const commands: KeymapCommand[] = []
  const fake = context({
    commands,
    handlers: {
      list: () =>
        Promise.resolve(
          output([
            flow({ id: "flw_manual", name: "Manual", status: "paused", run: "running" }),
          ]),
        ),
      runs: () =>
        Promise.resolve({ runs: [run("flw_manual", "running"), run("flw_manual", "succeeded", "flr_old", "ses_old")], warnings: [] }),
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 30 })
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
    expect(frame).toContain("shell: taskctl *")
    expect(frame).toContain("Run location")
    expect(frame).toContain("/workspace/run")
    expect(frame).toContain("Succeeded")
    command(commands, "down,j").run()
    await app.waitForFrame((frame) => frame.includes("› Running"))
    command(commands, "return").run()
    expect(fake.cleared).toEqual([true])
    expect(fake.focused).toEqual(["ses_flow_run"])
    expect(fake.destinations).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("falls back to Session navigation when tabs are unavailable", async () => {
  const commands: KeymapCommand[] = []
  const fake = context({
    commands,
    handlers: {
      list: () => Promise.resolve(output([flow({ id: "flw_navigation", name: "Navigation", status: "active", run: "succeeded" })])),
    },
  })
  const app = await testRender(
    () => (
      <FlowsDialog
        context={{
          ...fake.context,
          ui: {
            ...fake.context.ui,
            tabs: { ...fake.context.ui.tabs, focus: () => false },
          },
        }}
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
    expect(fake.destinations).toEqual([{ type: "session", sessionID: "ses_flow_run" }])
  } finally {
    app.renderer.destroy()
  }
})

test("runs, disables, enables, and offers deletion from a managed Flow's details", async () => {
  const commands: KeymapCommand[] = []
  const deleted: [string, boolean][] = []
  const active = flow({ id: "flw_control", name: "Controlled", status: "active", managed: true, worktree: "new" })
  const fake = context({
    commands,
    handlers: {
      list: () => Promise.resolve(output([active])),
      pause: () => Promise.resolve({ ...active, status: "paused" }),
      resume: () => Promise.resolve(active),
      run: () => Promise.resolve(run("flw_control")),
    },
  })
  const app = await testRender(
    () => (
      <FlowsDialog
        context={fake.context}
        actions={{
          create: () => {},
          edit: () => {},
          repair: () => {},
          delete: (flow, clean) => {
            deleted.push([flow.name, clean])
          },
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
    expect(deleted).toEqual([["Controlled", false]])
    command(commands, "w").run()
    expect(deleted).toEqual([
      ["Controlled", false],
      ["Controlled", true],
    ])
    command(commands, "space").run()
    await app.waitForFrame((frame) => frame.includes("Disabled Controlled"))
    command(commands, "space").run()
    await app.waitForFrame((frame) => frame.includes("Enabled Controlled"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("Starting Controlled"))
    expect(fake.methods().filter((method) => method !== "runs")).toEqual(["list", "pause", "resume", "run"])
  } finally {
    app.renderer.destroy()
  }
})

// A run started from one Flow's details can resolve after the user opened another Flow. Its history reload must neither
// abort nor replace the request of the Flow that is open now.
test("a late run result leaves the history of the Flow opened since", async () => {
  const commands: KeymapCommand[] = []
  const alpha = flow({ id: "flw_alpha", name: "Alpha", status: "paused", managed: true })
  const beta = flow({ id: "flw_beta", name: "Beta", status: "paused", managed: true })
  const started = Promise.withResolvers<KiloFlowRpc.Run>()
  const betaRuns = Promise.withResolvers<KiloFlowRpc.RunsOutput>()
  const fake = context({
    commands,
    handlers: {
      list: () => Promise.resolve(output([alpha, beta])),
      run: () => started.promise,
      runs: (input) =>
        input.flowID === "flw_beta"
          ? betaRuns.promise
          : Promise.resolve({ runs: [run("flw_alpha", "succeeded", "flr_alpha", "ses_alpha")], warnings: [] }),
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 30 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Alpha") && frame.includes("Beta"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Alpha") && frame.includes("Succeeded"))
    command(commands, "r").run()
    command(commands, "escape").run()
    await app.waitForFrame((frame) => !frame.includes("Periodic / Alpha"))
    command(commands, "down,j").run()
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Periodic / Beta"))

    started.resolve(run("flw_alpha"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    betaRuns.resolve({ runs: [run("flw_beta", "running", "flr_beta", "ses_beta")], warnings: [] })
    await app.waitForFrame((frame) => frame.includes("Periodic / Beta") && frame.includes("Running"))
    // The late reload for Alpha sent no request, so it could not abort Beta's.
    expect(
      fake.calls
        .filter((call) => call.method === "runs")
        .map((call) => String((call.input as KiloFlowRpc.ControlInput).flowID)),
    ).toEqual(["flw_alpha", "flw_beta"])
  } finally {
    app.renderer.destroy()
  }
})

test("deletes a Flow only after its name is typed and reports kept worktrees", async () => {
  const active = flow({ id: "flw_clean", name: "Clean", status: "active", managed: true, worktree: "new" })
  const fake = context({
    handlers: {
      remove: () =>
        Promise.resolve({
          removedWorktrees: [AbsolutePath.make("/tmp/kilo/flw_clean-1")],
          keptWorktrees: [AbsolutePath.make("/tmp/kilo/flw_clean-2")],
        }),
    },
    script: { prompts: { "Delete Clean?": "Clean" } },
  })
  const opened: unknown[] = []
  await deleteFlow(fake.context, (initial) => opened.push(initial), active, true)
  expect(fake.calls.find((call) => call.method === "remove")?.input).toEqual({
    flowID: "flw_clean",
    deleteWorktrees: true,
  })
  expect(fake.toasts).toContainEqual({
    variant: "success",
    message: "Deleted Clean. Removed 1 worktree.",
  })
  expect(fake.toasts).toContainEqual({
    variant: "warning",
    title: "Kept 1 worktree with changes",
    message: "/tmp/kilo/flw_clean-2",
  })
  expect(opened).toEqual([{}])
})

test("keeps a Flow when the typed name does not match", async () => {
  const active = flow({ id: "flw_keep", name: "Keep", status: "active", managed: true })
  const fake = context({ script: { prompts: { "Delete Keep?": "Kep" } } })
  const opened: unknown[] = []
  await deleteFlow(fake.context, (initial) => opened.push(initial), active, false)
  expect(fake.methods()).not.toContain("remove")
  expect(fake.toasts).toContainEqual({
    variant: "warning",
    title: "Flow not deleted",
    message: 'The name did not match "Keep".',
  })
  expect(opened).toEqual([{ key: "flw_keep", detail: true }])
})

test("keeps a Flow and reports a failed delete", async () => {
  const active = flow({ id: "flw_removed", name: "Removed elsewhere", status: "active", managed: true })
  const fake = context({
    handlers: { remove: () => Promise.reject(new Error("Flow does not exist")) },
    script: { prompts: { "Delete Removed elsewhere?": "Removed elsewhere" } },
  })
  const opened: unknown[] = []
  await deleteFlow(fake.context, (initial) => opened.push(initial), active, false)
  expect(fake.toasts).toContainEqual({
    variant: "error",
    title: "Delete failed",
    message: "Flow does not exist",
  })
  expect(opened).toEqual([{ key: "flw_removed", detail: true }])
})

test("shows failed and rejected run attempts as errors", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const active = flow({ id: "flw_failure", name: "Failure", status: "active", managed: true })
  const fake = context({
    commands,
    handlers: {
      list: () => Promise.resolve(output([active])),
      run: () => {
        calls++
        if (calls === 1) return Promise.resolve(run("flw_failure", "failed"))
        return Promise.reject(new Error("executor unavailable"))
      },
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 24 })
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
  const active = flow({ id: "flw_busy", name: "Busy", status: "active", run: "running" })
  const fake = context({
    commands,
    handlers: {
      list: () => Promise.resolve(output([active])),
      run: () =>
        Promise.resolve(
          Schema.decodeUnknownSync(KiloFlowRpc.Run)({
            version: 1,
            id: "flr_skipped",
            flowID: "flw_busy",
            status: "skipped",
            worktree: "reuse",
            time: { created: 30, updated: 30, completed: 30 },
          }),
        ),
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 24 })
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
    expect(fake.focused).toEqual(["ses_flow_run"])
  } finally {
    app.renderer.destroy()
  }
})

test("labels agent tasks, internal schedules and native prompts as read-only", async () => {
  const commands: KeymapCommand[] = []
  const fake = context({
    commands,
    handlers: {
      list: () =>
        Promise.resolve(
          output([
            flow({ id: "sch_wakeup", name: "Wakeup: check the build", status: "active", action: "hook", prompt: "check the build" }),
            flow({ id: "sch_cron", name: "Cron: 0 9 * * 1", status: "active", action: "hook" }),
            flow({ id: "sch_orphan", name: "Missing owner", status: "active", action: "hook", prompt: "" }),
            flow({ id: "sch_prompt", name: "Daily cleanup", status: "active", action: "prompt" }),
          ]),
        ),
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 100, height: 30 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Wakeup: check the build"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("agent task")
    expect(frame).toContain("internal")
    expect(frame).toContain("schedule")
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("Agent tasks are read-only"))
    expect(enabled(command(commands, "r"))).toBeFalse()
    expect(enabled(command(commands, "e"))).toBeFalse()
    expect(enabled(command(commands, "d"))).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test("shows the prompt of an agent task whose schedule row predates storing it", async () => {
  const commands: KeymapCommand[] = []
  const fake = context({
    commands,
    handlers: {
      list: () =>
        Promise.resolve(
          output([
            flow({ id: "sch_old", name: "Wakeup: nightly", status: "active", action: "hook", prompt: "" }),
            flow({ id: "sch_orphan", name: "Wakeup: missing owner", status: "active", action: "hook", prompt: "" }),
          ]),
        ),
    },
    wakeups: (scheduleID) => (scheduleID === "sch_old" ? "check the nightly build" : undefined),
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 100, height: 30 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Wakeup: nightly"))
    command(commands, "return").run()
    await app.waitForFrame((frame) => frame.includes("check the nightly build"))
    // One read for every blank row, and no `list` that would reconcile and could drop a paused or finished row.
    expect(fake.wakeupCalls.filter((call) => call.method === "prompts")).toHaveLength(1)
    expect(fake.wakeupCalls.find((call) => call.method === "prompts")?.input).toEqual({
      scheduleIDs: ["sch_old", "sch_orphan"],
    })
    expect(fake.wakeupCalls.some((call) => call.method === "list")).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the last successful result visible and marks it stale after refresh fails", async () => {
  const commands: KeymapCommand[] = []
  let calls = 0
  const fake = context({
    commands,
    handlers: {
      list: () => {
        calls++
        if (calls === 1) return Promise.resolve(output([flow({ id: "sch_kept", name: "Kept flow", status: "active" })]))
        return Promise.reject(new Error("server unavailable"))
      },
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 20 })
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
  const fake = context({
    commands,
    handlers: {
      list: () => {
        calls++
        return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(output())
      },
    },
  })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 20 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Couldn’t load flows") && frame.includes("Press r to retry"))
    command(commands, "r").run()
    await app.waitForFrame((frame) => frame.includes("No periodic flows"))
  } finally {
    app.renderer.destroy()
  }

  const pending = Promise.withResolvers<KiloFlowRpc.ListOutput>()
  const signals: AbortSignal[] = []
  const cleanupCommands: KeymapCommand[] = []
  const pendingContext = context({
    commands: cleanupCommands,
    handlers: { list: () => pending.promise },
    onListCall: (call) => call?.signal && signals.push(call.signal),
  })
  const cleanup = await testRender(() => <FlowsDialog context={pendingContext.context} />, { width: 88, height: 20 })
  cleanup.renderer.start()
  await cleanup.waitForFrame((frame) => frame.includes("Loading local flows"))
  command(cleanupCommands, "r").run()
  await Bun.sleep(15)
  expect(pendingContext.methods().filter((method) => method === "list").length).toBe(1)
  cleanup.renderer.destroy()
  expect(signals[0]?.aborted).toBeTrue()
})

test("refreshes the open dialog on changed events for its project only", async () => {
  const commands: KeymapCommand[] = []
  const fake = context({ commands, handlers: { list: () => Promise.resolve(output([flow({ id: "flw_live", name: "Live", status: "active", managed: true })])) } })
  const app = await testRender(() => <FlowsDialog context={fake.context} />, { width: 88, height: 24 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Live"))
    const before = fake.methods().length
    fake.emit({ projectID: Project.ID.make("proj_other"), kind: "run" })
    await Bun.sleep(5)
    expect(fake.methods().length).toBe(before)
    fake.emit({ projectID: Project.ID.make("proj_tui"), flowID: KiloFlowRpc.ID.make("flw_live"), kind: "run" })
    await app.waitForFrame(() => fake.methods().length > before)
    expect(fake.methods().filter((method) => method === "list").length).toBe(2)
  } finally {
    app.renderer.destroy()
  }
})

test("creates a Flow from the current session through the wizard", async () => {
  const created = flow({ id: "flw_created", name: "Review the weekend commits", status: "active", managed: true })
  const fake = context({
    handlers: { create: () => Promise.resolve(created) },
    script: {
      prompts: { "shell resource": "awk '{print $1,$2}' report.csv" },
      selects: { Schedule: "every", Permissions: ["add", "done"], "Permission action": "shell" },
    },
  })
  const opened: unknown[] = []
  await createFlow(fake.context, (initial) => opened.push(initial), {})
  expect(fake.calls.find((call) => call.method === "create")?.input).toMatchObject({
    sourceSessionID: "ses_tui",
    prompt: "Review the weekend commits",
    name: "Review the weekend commits",
    worktree: "reuse",
    // One field per resource, so a comma stays part of the command.
    permissions: [{ action: "shell", resource: "awk '{print $1,$2}' report.csv" }],
    when: { tz: expect.any(String) },
  })
  expect(fake.cleared.length).toBeGreaterThan(0)
  expect(fake.toasts.some((toast) => toast.message.includes("Approve the Flow's permissions"))).toBeTrue()
  expect(opened).toEqual([{ key: "flw_created" }])
})

test("lists the baseline as fixed rows and the additional grants as editable rows", async () => {
  const fake = context({ script: { selects: { Permissions: "done" } } })
  await createFlow(fake.context, () => undefined, {})
  const rows = fake.selects.find((select) => select.title.includes("Permissions"))?.options ?? []
  expect(rows.map((row) => [row.title, row.value])).toEqual([
    ["read: *", "baseline"],
    ["glob: *", "baseline"],
    ["grep: *", "baseline"],
    ["Add permission…", "add"],
    ["Done", "done"],
  ])
})

test("asks for a rejected resource again with the server's rule and the value kept", async () => {
  const fake = context({
    script: {
      prompts: { "shell resource": ["/home/user/*", "npm test"], "MCP tool": "github_create_issue" },
      selects: { Permissions: ["add", "add", "done"], "Permission action": ["shell", "other"] },
    },
  })
  await createFlow(fake.context, () => undefined, {})
  const retried = fake.prompts.filter((prompt) => prompt.title.includes("shell resource"))
  expect(retried).toHaveLength(2)
  expect(retried[1]?.value).toBe("/home/user/*")
  expect(retried[1]?.description).toContain("use external_directory: /home/user/*")
  expect(fake.calls.find((call) => call.method === "create")?.input).toMatchObject({
    permissions: [
      { action: "shell", resource: "npm test" },
      // An MCP tool's resource defaults to `*`.
      { action: "github_create_issue", resource: "*" },
    ],
  })
})

test("returns to the permission step when the creation is rejected", async () => {
  const fake = context({
    handlers: { create: () => Promise.reject(new Error("permission denied")) },
    // The wizard's Permissions step, then the retry: cancelling it reopens /periodic.
    script: { selects: { Permissions: ["done"] } },
  })
  const opened: unknown[] = []
  await createFlow(fake.context, (initial) => opened.push(initial), { key: "flw_active", detail: true })
  expect(fake.toasts).toContainEqual({
    variant: "error",
    title: "Flow not created",
    message: "permission denied",
  })
  expect(fake.selects.filter((select) => select.title.includes("Permissions"))).toHaveLength(2)
  expect(opened).toEqual([{ key: "flw_active", detail: true }])
})

test("reuses the request id when a rejected create is retried", async () => {
  const fake = context({
    handlers: { create: () => Promise.reject(new Error("permission denied")) },
    // The draft's Permissions step, the failure's Permissions step, then the retry's failure: cancel and reopen.
    script: { selects: { Permissions: ["done", "done"] } },
  })
  const opened: unknown[] = []
  await createFlow(fake.context, (initial) => opened.push(initial), { key: "flw_active", detail: true })
  const requestIDs = fake.calls
    .filter((call) => call.method === "create")
    .map((call) => (call.input as { requestID?: string }).requestID)
  expect(requestIDs).toHaveLength(2)
  // The retry reuses the idempotency key, so a lost first response cannot create a second Flow.
  expect(requestIDs[0]).toMatch(/^[0-9a-f]{32}$/)
  expect(requestIDs[1]).toBe(requestIDs[0])
  expect(fake.selects.filter((select) => select.title.includes("Permissions"))).toHaveLength(3)
  expect(opened).toEqual([{ key: "flw_active", detail: true }])
})

test("editing sends only changed fields and re-approves a new allowlist", async () => {
  const current = flow({
    id: "flw_edit",
    name: "Weekly report",
    status: "active",
    managed: true,
    prompt: "Write the report",
  })
  const renamed = {
    ...current,
    name: "Weekly summary",
  }
  const renamedContext = context({
    handlers: { update: () => Promise.resolve(renamed) },
    script: { prompts: { Name: "Weekly summary" } },
  })
  const opened: unknown[] = []
  await editFlow(renamedContext.context, (initial) => opened.push(initial), current)
  expect(renamedContext.methods()).toEqual([])
  expect(opened).toEqual([{ key: "flw_edit", detail: true, save: { flowID: "flw_edit", name: "Weekly summary" } }])

  const approvedContext = context({
    handlers: { update: () => Promise.resolve(current) },
    script: {
      prompts: { "shell resource": "npm test" },
      selects: { Permissions: ["grant:0", "done"], "shell: taskctl": "edit", "Permission action": "shell" },
    },
  })
  await editFlow(approvedContext.context, (initial) => opened.push(initial), current)
  expect(approvedContext.cleared).toEqual([true])
  expect(approvedContext.calls.find((call) => call.method === "update")?.input).toEqual({
    flowID: "flw_edit",
    permissions: [{ action: "shell", resource: "npm test" }],
    sessionID: "ses_tui",
  })
})

test("deleting and adding rows rejects baseline and duplicate grants", async () => {
  const current = flow({
    id: "flw_edit",
    name: "Weekly report",
    status: "active",
    managed: true,
    permissions: [
      { action: "shell", resource: "taskctl *" },
      { action: "edit", resource: "reports/*" },
    ],
  })
  const fake = context({
    handlers: { update: () => Promise.resolve(current) },
    script: {
      prompts: { "read resource": ["*", "reports/*"], "edit resource": ["reports/*", "docs/*"] },
      selects: {
        Permissions: ["grant:0", "add", "add", "done"],
        "shell: taskctl": "delete",
        "Permission action": ["read", "edit"],
      },
    },
  })
  await editFlow(fake.context, () => undefined, current)
  const read = fake.prompts.filter((prompt) => prompt.title.includes("read resource"))
  expect(read[1]?.description).toBe("read: * is always included.")
  const edit = fake.prompts.filter((prompt) => prompt.title.includes("edit resource"))
  expect(edit[1]?.description).toBe("edit: reports/* is already in the list.")
  expect(fake.calls.find((call) => call.method === "update")?.input).toMatchObject({
    permissions: [
      { action: "edit", resource: "reports/*" },
      { action: "read", resource: "reports/*" },
      { action: "edit", resource: "docs/*" },
    ],
  })
})

test("treats an existing grant action that only exists on the prototype as an MCP tool", async () => {
  const current = flow({
    id: "flw_proto",
    name: "Prototype",
    status: "active",
    managed: true,
    permissions: [{ action: "toString", resource: "*" }],
  })
  const fake = context({
    handlers: { update: () => Promise.resolve(current) },
    script: { selects: { Permissions: ["grant:0", "done"], "toString: *": "edit" } },
  })
  await editFlow(fake.context, () => undefined, current)
  const action = fake.selects.find((select) => select.title.includes("Permission action"))
  expect(action?.current).toBe("other")
})

test("asks for approval in the source session when edited from a Flow run session", async () => {
  const current = flow({ id: "flw_edit", name: "Weekly report", status: "active", managed: true })
  const fake = context({
    route: { type: "session", sessionID: "ses_flow_run" },
    handlers: { update: () => Promise.resolve(current) },
    script: {
      selects: { Permissions: ["grant:0", "done"], "shell: taskctl": "delete" },
    },
  })
  await editFlow(fake.context, () => undefined, current)
  expect(fake.calls.find((call) => call.method === "update")?.input).toEqual({ flowID: "flw_edit", permissions: [] })
  expect(fake.focused).toEqual(["ses_tui"])
})

test("repairing creates the replacement and deletes the broken Flow", async () => {
  const broken = flow({ id: "flw_broken", name: "Broken", status: "error", managed: true, error: "Backing schedule missing" })
  const created = flow({ id: "flw_repaired", name: "Broken", status: "active", managed: true })
  const fake = context({ handlers: { create: () => Promise.resolve(created) } })
  const opened: unknown[] = []
  await createFlow(fake.context, (initial) => opened.push(initial), { key: "flw_broken", detail: true }, broken)
  expect(fake.methods()).toEqual(["create", "remove"])
  expect(fake.calls[1]?.input).toEqual({ flowID: "flw_broken" })
  expect(opened).toEqual([{ key: "flw_repaired" }])
})

test("maps Flow definitions to wizard drafts, changes and permissions", () => {
  const current = flow({
    id: "flw_draft",
    name: "Draft",
    status: "active",
    managed: true,
    prompt: "Keep the tree tidy",
    ends: { times: 3 },
    permissions: [{ action: "shell", resource: "git status" }],
  })
  expect(fromFlow(current)).toEqual({
    prompt: "Keep the tree tidy",
    name: "Draft",
    schedule: { type: "every", value: "1 hour", timezone: "UTC" },
    worktree: "reuse",
    end: { type: "times", value: "3" },
    permissions: [{ action: "shell", resource: "git status" }],
  })
  expect(changes(fromFlow(current), { ...fromFlow(current), name: "Renamed" })).toEqual({ name: "Renamed" })
  expect(deriveName("First line\nSecond line")).toBe("First line")
  expect(deriveName("x".repeat(60))).toBe(`${"x".repeat(40)}…`)
  expect(endsLabel({ times: 1 })).toBe("After 1 run")
  expect(endsLabel({ times: 2, after: "30 days" })).toBe("After 2 runs or after 30 days")
})
