import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { expect, spyOn, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

const sessionID = "ses_copy_session"

async function launch(args: { sessionID?: string }) {
  const state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  Object.defineProperty(setup.renderer, "capabilities", { get: () => null })
  const copy = spyOn(setup.renderer, "copyToClipboardOSC52").mockReturnValue(true)
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "proj_test",
          title: "Copy session fixture",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
      return json({ data: [] })
    if (url.pathname === `/api/experimental/session/${sessionID}/export`)
      return json({
        data: {
          info: { id: sessionID, title: "Copy session fixture", time: { created: 0, updated: 0 } },
          messages: [],
        },
      })
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args,
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  const dispose = async () => {
    copy.mockRestore()
    setup.renderer.destroy()
    await task
    await server.stop()
    await state[Symbol.asyncDispose]()
  }
  return { setup, copy, dispose }
}

test("the /copy-session slash command resolves to the native session transcript copy", async () => {
  const { setup, copy, dispose } = await launch({ sessionID })
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.typeText("/copy-session")
    await setup.waitForFrame((frame) => frame.includes("Copy the whole session transcript"))
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((frame) => frame.includes("Session transcript copied to clipboard!"))
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy.mock.calls[0]?.[0]).toContain(sessionID)
    expect(copy.mock.calls[0]?.[0]).toContain("Copy session fixture")
    expect(frame).not.toContain("Copy the whole session transcript")
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedEditor instanceof TextareaRenderable &&
        !(setup.renderer.currentFocusedEditor instanceof InputRenderable),
    )
  } finally {
    await dispose()
  }
})

test("the /copy-session slash command is not offered outside a session", async () => {
  const { setup, copy, dispose } = await launch({})
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.typeText("/copy-session")
    await setup.waitForFrame((frame) => frame.includes("/copy-session"))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Copy the whole session transcript")
    expect(copy).not.toHaveBeenCalled()
  } finally {
    await dispose()
  }
})

test("the palette keeps the single native Copy session transcript command", async () => {
  const { setup, dispose } = await launch({ sessionID })
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.pressKey("p", { ctrl: true })
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
    await setup.mockInput.typeText("Copy session transcript")
    await setup.waitForFrame((frame) => frame.includes("Copy session transcript"))
    await setup.renderOnce()
    const rows = setup
      .captureCharFrame()
      .split("\n")
      .filter((line) => line.includes("Copy session transcript"))
    // The native command owns the palette row; the plugin command is slash-only, so no Kilo row duplicates it.
    expect(rows.filter((line) => line.includes("Kilo"))).toHaveLength(0)
    expect(rows.filter((line) => line.includes("Session"))).toHaveLength(1)
  } finally {
    await dispose()
  }
})
