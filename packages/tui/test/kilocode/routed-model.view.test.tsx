import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"
import { catalogModel } from "../mini/fixture/catalog"

test("production session shows each route while keeping Auto selected", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 112, height: 38, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const model = { providerID: "kilo", id: "kilo-auto/free" }
  const session = {
    id: "ses_routed_ui",
    title: "Routed session",
    projectID: "proj_test",
    location: { directory },
    agent: "build",
    model,
    cost: 0.3,
    tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 10 },
  }
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "msg_user", text: "Check routed steps", time: { created: 0 } },
    ...["openai/gpt-5.5-2026-04-23", "openai/gpt-5.5-2026-04-23", "anthropic/claude-sonnet-4.6"].map(
      (route, index) => ({
        type: "assistant" as const,
        id: `msg_assistant_${index}`,
        agent: "build",
        model,
        native: { kilo: { routedModelID: route, vercelID: `request-${index}` } },
        finish: index < 2 ? ("tool-calls" as const) : ("stop" as const),
        content:
          index === 1
            ? [{ type: "reasoning" as const, text: "Intermediate step", time: { created: 1, completed: 2 } }]
            : [{ type: "text" as const, text: "Route complete" }],
        tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: index * 2 + 1, completed: index * 2 + 2 },
      }),
    ),
  ]
  const selected: unknown[] = []
  let modelsLoaded: () => void = () => {}
  const modelCatalog = new Promise<void>((resolve) => { modelsLoaded = resolve })
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/model`) selected.push(request)
    if (url.pathname === "/api/model") {
      modelsLoaded()
      return json({
        location: { directory },
        data: [
          catalogModel({ ...model, name: "Auto" }),
          catalogModel({ providerID: "kilo", id: "anthropic/claude-sonnet-4.6", name: "Anthropic: Claude Sonnet 4.6" }),
        ],
      })
    }
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false }, debug: { turn_tokens: true } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await modelCatalog
    // Windows can still have a render scheduled when the default passes run out.
    const wait = { maxPasses: 200 }
    await setup.waitForFrame((frame) => frame.includes("Auto") && frame.includes("Claude Sonnet 4.6"), wait)
    await setup.waitForVisualIdle()
    const thought = setup
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("Thought"))
    expect(setup.captureCharFrame().split("\n")[thought]).toContain("gpt-5.5")
    await setup.mockMouse.click(6, thought)
    await setup.waitForFrame((frame) => frame.includes("Routed to gpt-5.5"), wait)
    await setup.waitForVisualIdle()
    const row = setup
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("+ Tokens"))
    expect(row).toBeGreaterThan(0)
    await setup.mockMouse.click(6, row)
    await setup.waitForFrame((frame) => frame.includes("tool-call") && frame.includes("gpt-5.5"), wait)
    await setup.waitForVisualIdle()
    const lines = setup.captureCharFrame().split("\n")
    expect(lines.find((line) => line.includes("tool-call"))).toContain("gpt-5.5")
    expect(lines.find((line) => line.trim().startsWith("stop"))).toContain("Claude Sonnet 4.6")
    expect(selected).toEqual([])
    expect(session.model).toEqual(model)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}, 30_000)
