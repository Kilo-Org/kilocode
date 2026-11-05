import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, json } from "../fixture/tui-client"
import { run } from "../../src/app"
import { tmpdir } from "../fixture/fixture"

async function launch(initial = { enabled: false, connected: true }, fail = false) {
  const state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  Object.defineProperty(setup.renderer, "capabilities", { get: () => null })
  const status = { ...initial }
  const methods: string[] = []
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (!url.pathname.startsWith("/api/rpc/kilocode.remote/")) return undefined
    const method = url.pathname.split("/").at(-1)!
    expect(await request.json()).toMatchObject({ input: {} })
    methods.push(method)
    if (fail && method === "enable") return json({ message: "Remote control unavailable" }, { status: 500 })
    if (method === "enable") status.enabled = true
    if (method === "disable") status.enabled = false
    return json({ output: { ...status } })
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: {},
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  return {
    setup,
    methods,
    toggle: async () => {
      await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
      setup.mockInput.typeText("/remote")
      await setup.waitForFrame((frame) => frame.includes("Allow or stop remote commands for this process"))
      setup.mockInput.pressEnter()
    },
    dispose: async () => {
      setup.renderer.destroy()
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
      (frame) => frame.includes("Remote control") && !frame.includes("Allow or stop remote commands"),
    )
    expect(app.setup.captureCharFrame()).not.toContain("● Remote control")
    expect(app.setup.captureCharFrame()).not.toContain("○ Remote control")
  } finally {
    await app.dispose()
  }
})
