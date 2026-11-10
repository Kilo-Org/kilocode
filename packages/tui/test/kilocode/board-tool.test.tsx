import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { SessionMessageAssistantTool, SessionMessageInfo, SessionMessageToolStateCompleted } from "@opencode/client"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: "test", id: "test" }

const posted = {
  id: "board_1",
  timestamp: 1,
  from: "main",
  to: "ses_helper12345678",
  fromLabel: "Release investigation",
  toLabel: "Inspect publish timeout",
  type: "INFO",
  body: "The **larger package** succeeded.",
  availability: "running",
  receipt: "Stored only. This does not confirm delivery, reading, or action, and does not wake recipients.",
}

function toolPart(
  id: string,
  name: string,
  input: SessionMessageToolStateCompleted["input"],
  output: unknown,
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id,
    name,
    state: {
      status: "completed",
      input,
      content: [{ type: "text", text: JSON.stringify(output) }],
      metadata: {},
    },
    time: { created: 1, completed: 2 },
  }
}

const messages: SessionMessageInfo[] = [
  { type: "user", id: "msg_user", text: "Coordinate", time: { created: 1 } },
  {
    type: "assistant",
    id: "msg_assistant",
    agent: "build",
    model,
    finish: "tool-calls",
    content: [
      toolPart("tool_post", "board_post", { to: posted.to, type: "INFO", body: posted.body }, posted),
      toolPart(
        "tool_read",
        "board_read",
        {},
        {
          messages: [
            { ...posted, id: "board_2", from: "ses_helper12345678", to: "main", fromLabel: undefined, toLabel: undefined, type: "RESULT", body: "Timeout fixed." },
          ],
          cursor: "board_2",
          hasMore: true,
        },
      ),
    ],
    time: { created: 2, completed: 3 },
  },
]

const session = {
  id: "ses_board",
  title: "Board",
  projectID: "proj_test",
  location: { directory },
  agent: "build",
  model,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 10 },
}

test("renders board posts and reads", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 120, height: 50, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()

  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (/^\/api\/session\/[^/]+\/inbox$/.test(url.pathname)) return json({ data: [] })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })

  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false } }),
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
      (frame) => frame.includes("Shared agent board (1 message)") && frame.includes("Timeout fixed."),
      { maxPasses: 200 },
    )
    await setup.waitForVisualIdle()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("INFO · Release investigation → Inspect publish timeout")
    expect(frame).toContain("larger package")
    expect(frame).toContain("Stored only. Delivery and reading are not confirmed.")
    expect(frame).toContain("RESULT · Agent · 12345678 → Primary agent")
    expect(frame).toContain("More messages are available.")
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}, 30_000)
