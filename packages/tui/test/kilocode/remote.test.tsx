import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { run } from "../../src/app"
import { tmpdir } from "../fixture/fixture"

async function launch(initial = { enabled: false, connected: true }, fail = false, holdStatus = false, resume = false) {
  const state = await tmpdir()
  const plugin = path.join(state.path, "remote-plugin")
  await mkdir(plugin)
  await Bun.write(
    path.join(plugin, "tui.tsx"),
    `export { default } from ${JSON.stringify(new URL("../../src/kilocode/remote.tsx", import.meta.url).href)}\n`,
  )
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  Object.defineProperty(setup.renderer, "capabilities", { get: () => null })
  const status = { ...initial }
  const methods: string[] = []
  const locations: string[] = []
  const inputs: unknown[] = []
  const attachWaiters: Array<{ after: number; resolve: () => void }> = []
  const restored = {
    id: "ses_restored",
    title: "Restored without local input",
    projectID: "proj_test",
    location: { directory: `${directory}/child` },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const held: Array<() => void> = []
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (resume && url.pathname === "/api/session") return json({ data: [restored], cursor: {} })
    if (resume && url.pathname === `/api/session/${restored.id}`) return json({ data: restored })
    if (resume && /^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
      return json({ data: [], cursor: {} })
    if (!url.pathname.startsWith("/api/rpc/kilocode.remote/")) return undefined
    const method = url.pathname.split("/").at(-1)!
    const body = await request.json()
    expect(body).toMatchObject({ input: method === "attach" ? { sessionID: restored.id } : {} })
    inputs.push(body.input)
    locations.push(url.searchParams.get("location[directory]")!)
    methods.push(method)
    if (method === "attach") {
      const count = methods.filter((value) => value === "attach").length
      for (const waiter of attachWaiters.splice(0)) {
        if (count > waiter.after) waiter.resolve()
        else attachWaiters.push(waiter)
      }
    }
    if (holdStatus && method === "status") {
      const pending = Promise.withResolvers<Response>()
      held.push(() => pending.resolve(json({ output: { ...status } })))
      return pending.promise
    }
    if (fail && method === "enable")
      return json(
        {
          _tag: "RpcError",
          type: "failed",
          message: "Sign in to enable remote control",
          data: { code: "signed_out", message: "Sign in to enable remote control" },
        },
        { status: 400 },
      )
    if (method === "enable") status.enabled = true
    if (method === "disable") status.enabled = false
    return json({ output: { ...status } })
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false, plugins: [plugin] }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: resume ? { sessionID: restored.id } : {},
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  return {
    setup,
    methods,
    inputs,
    locations,
    reconnect: () => events.disconnect(),
    waitForAttach: (after: number) => {
      if (methods.filter((method) => method === "attach").length > after) return Promise.resolve()
      const next = Promise.withResolvers<void>()
      attachWaiters.push({ after, resolve: next.resolve })
      return next.promise
    },
    toggle: async () => {
      await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
      setup.mockInput.typeText("/remote")
      await setup.waitForFrame((frame) => frame.includes("Allow or stop remote commands for this workspace"))
      setup.mockInput.pressEnter()
    },
    dispose: async () => {
      setup.renderer.destroy()
      held.forEach((release) => release())
      await task
      await server.stop()
      await state[Symbol.asyncDispose]()
    },
  }
}

test("/remote enables and disables through the typed RPC and shows a process header only while enabled", async () => {
  const app = await launch()
  try {
    await app.setup.waitFor(() => app.methods.includes("status"))
    expect(app.setup.captureCharFrame()).not.toContain("● Remote control")
    await app.toggle()
    const enabled = await app.setup.waitForFrame(
      (frame) => frame.includes("● Remote control") && frame.includes("Remote control enabled"),
    )
    expect(enabled.split("\n").find((line) => line.trim())).toContain("● Remote control")
    expect(app.methods.filter((method) => method === "enable")).toHaveLength(1)
    await app.toggle()
    await app.setup.waitForFrame(
      (frame) => frame.includes("Remote control disabled") && !frame.includes("● Remote control"),
    )
    expect(app.methods.filter((method) => method === "disable")).toHaveLength(1)
  } finally {
    await app.dispose()
  }
})

test("a restored session is announced in the launch workspace without a local prompt", async () => {
  const app = await launch({ enabled: true, connected: true }, false, false, true)
  try {
    await app.waitForAttach(0)
    await app.setup.waitForFrame((frame) => frame.includes("● Remote control"))
    expect(app.inputs[app.methods.indexOf("attach")]).toEqual({ sessionID: "ses_restored" })
    expect(app.locations[app.methods.indexOf("attach")]).toBe(directory)
    const beforeReconnect = app.methods.filter((method) => method === "attach").length
    const reattached = app.waitForAttach(beforeReconnect)
    app.reconnect()
    await reattached
    const afterReconnect = app.methods.filter((method) => method === "attach").length
    await app.toggle()
    await app.setup.waitForFrame((frame) => frame.includes("Remote control disabled"))
    expect(app.methods.filter((method) => method === "attach")).toHaveLength(afterReconnect)
    expect(app.locations.every((location) => location === directory)).toBe(true)
  } finally {
    await app.dispose()
  }
})

test("an auto-enabled process shows disconnected status and can be disabled", async () => {
  const app = await launch({ enabled: true, connected: false })
  try {
    await app.setup.waitForFrame((frame) => frame.includes("○ Remote control · disconnected"))
    await app.toggle()
    await app.setup.waitForFrame(
      (frame) => frame.includes("Remote control disabled") && !frame.includes("○ Remote control"),
    )
    expect(app.methods).toContain("disable")
    expect(app.methods).not.toContain("enable")
  } finally {
    await app.dispose()
  }
})

test("a rejected enable reports an error without showing a false enabled header", async () => {
  const app = await launch({ enabled: false, connected: false }, true)
  try {
    await app.toggle()
    await app.setup.waitFor(() => app.methods.includes("enable"))
    await app.setup.waitForFrame(
      (frame) => frame.includes("Sign in to enable remote control") && !frame.includes("Allow or stop remote commands"),
    )
    expect(app.setup.captureCharFrame()).not.toContain("● Remote control")
    expect(app.setup.captureCharFrame()).not.toContain("○ Remote control")
    expect(app.setup.captureCharFrame()).not.toContain("[object Object]")
  } finally {
    await app.dispose()
  }
})

test("a stalled status read stays single-flight across polling ticks and shutdown completes", async () => {
  const app = await launch({ enabled: false, connected: false }, false, true)
  try {
    await app.setup.waitFor(() => app.methods.includes("status"))
    // Sample after the real 5 s interval: a stalled request must not admit the next polling tick.
    await Bun.sleep(5_500)
    expect(app.methods.filter((method) => method === "status")).toHaveLength(1)
  } finally {
    await app.dispose()
  }
}, 15_000)
