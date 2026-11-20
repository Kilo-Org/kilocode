// The transcript draws a browser_type row and a Code Mode browser.type call with the typed text masked: the mask must
// sit on the tool row's input and on the Execute call rows, not only in the helper's unit tests.
import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: "test", id: "test" }
const password = "hunter2"
const pin = "4096-2048"

function toolPart(id: string, name: string, state: SessionMessageAssistantTool["state"]): SessionMessageAssistantTool {
  return { type: "tool", id, name, state, time: { created: 1, completed: 2 } }
}

const messages: SessionMessageInfo[] = [
  { type: "user", id: "msg_user", text: "Sign in", time: { created: 1 } },
  {
    type: "assistant",
    id: "msg_assistant",
    agent: "build",
    model,
    finish: "tool-calls",
    content: [
      toolPart("tool_type", "browser_type", {
        status: "completed",
        input: { target: "e2", text: password },
        content: [{ type: "text", text: "Typed" }],
        metadata: {},
      }),
      toolPart("tool_execute", "execute", {
        status: "completed",
        input: { code: "await signIn()" },
        content: [{ type: "text", text: "done" }],
        metadata: {
          toolCalls: [{ tool: "browser.type", status: "completed", input: { target: "e3", text: pin } }],
        },
      }),
    ],
    time: { created: 2, completed: 3 },
  },
]

const session = {
  id: "ses_browser",
  title: "Browser",
  projectID: "proj_test",
  location: { directory },
  agent: "build",
  model,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 10 },
}

test("masks typed text in a browser_type row and in a Code Mode browser.type call row", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 120, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()

  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })

  // Loaded after the renderer and server start, as the other TUI view tests load the app.
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false }, session: { verbosity: "high" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )

  try {
    await setup.waitForFrame(
      (frame) => frame.includes("browser_type [target=e2") && frame.includes("browser.type [target=e3"),
      { maxPasses: 200 },
    )
    await setup.waitForVisualIdle()

    const frame = setup.captureCharFrame()
    const lines = frame.split("\n")
    const find = (text: string) => lines.find((line) => line.includes(text)) ?? ""
    expect(find("browser_type [target=e2")).toContain("browser_type [target=e2, text=•••]")
    expect(find("browser.type [target=e3")).toContain("browser.type [target=e3, text=•••]")
    expect(frame).not.toContain(password)
    expect(frame).not.toContain(pin)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}, 30_000)
