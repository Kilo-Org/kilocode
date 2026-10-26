import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"
import { catalogModel, catalogProvider } from "../mini/fixture/catalog"

test("sidebar shows the Kilo panels in v1 order, with family usage per routed model and the balance", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 170, height: 70, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const model = { providerID: "kilo", id: "kilo-auto/frontier" }
  const tokens = { input: 1_000, output: 200, reasoning: 0, cache: { read: 1_000, write: 0 } }
  const info = (id: string, parentID?: string) => ({
    id,
    ...(parentID ? { parentID } : {}),
    title: id,
    projectID: "proj_test",
    location: { directory },
    agent: "build",
    model,
    cost: 0.35,
    tokens,
    time: { created: 0, updated: 10 },
  })
  const root = info("ses_sidebar_root")
  const child = info("ses_sidebar_child", root.id)
  const step = (id: string, input: { model?: typeof model; route?: string; cost: number }): SessionMessageInfo => ({
    type: "assistant",
    id,
    agent: "build",
    model: input.model ?? model,
    ...(input.route ? { native: { kilo: { routedModelID: input.route } } } : {}),
    finish: "stop",
    content: [{ type: "text", text: "Done" }],
    cost: input.cost,
    tokens,
    time: { created: 1_000, completed: 2_000 },
  })
  const messages: Record<string, SessionMessageInfo[]> = {
    [root.id]: [
      { type: "user", id: "msg_user", text: "Check sidebar", time: { created: 0 } },
      step("msg_a", { route: "anthropic/claude-sonnet-4.6", cost: 0.2 }),
      step("msg_b", { route: "anthropic/claude-sonnet-4.6", cost: 0.1 }),
    ],
    [child.id]: [step("msg_c", { model: { providerID: "openai", id: "gpt-5.4" }, cost: 0.05 })],
  }
  const calls = createFetch((url) => {
    const location = { directory }
    if (url.pathname === "/api/session")
      return json({ data: url.searchParams.get("parentID") === root.id ? [child] : [root], cursor: {} })
    for (const session of [root, child]) {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) {
        // The panel reads every page; the transcript reads the first page only.
        const list = messages[session.id].toReversed()
        if (url.searchParams.get("limit") !== "200") return json({ data: list, cursor: {} })
        if (!url.searchParams.get("cursor")) return json({ data: list.slice(0, 1), cursor: { next: "page-2" } })
        return json({ data: list.slice(1), cursor: {} })
      }
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    }
    if (url.pathname === "/api/model")
      return json({
        location,
        data: [
          catalogModel({ ...model, name: "Kilo Auto Frontier" }),
          catalogModel({ providerID: "kilo", id: "anthropic/claude-sonnet-4.6", name: "Anthropic: Claude Sonnet 4.6" }),
          catalogModel({ providerID: "openai", id: "gpt-5.4", name: "GPT-5.4" }),
        ],
      })
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/provider")
      return json({ location, data: [catalogProvider("kilo", "Kilo Gateway"), catalogProvider("openai", "OpenAI")] })
    if (url.pathname === "/api/mcp")
      return json({ location, data: [{ name: "docs", status: { status: "connected" } }] })
    if (url.pathname === "/api/integration")
      return json({
        location,
        data: [{ id: "kilo", name: "Kilo Gateway", methods: [], connections: [{ type: "env", name: "KILO_API_KEY" }] }],
      })
    if (url.pathname === "/api/rpc/kilocode.gateway/profile")
      return json({
        output: { email: "fixture@example.test", organizations: [], hasPersonalAccount: true, organizationID: null },
      })
    if (url.pathname === "/api/rpc/kilocode.gateway/balance") return json({ output: { balance: 1.5 } })
    if (url.pathname === "/api/rpc/kilocode.gateway/models")
      return json({
        output: [
          {
            id: "kilo-auto/frontier",
            name: "Kilo Auto Frontier",
            isFree: false,
            terminalBench: { overallScore: 0.61, avgAttemptCostUsd: 2.1 },
          },
        ],
      })
    if (url.pathname.startsWith("/api/rpc/")) return json({ output: null })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false, tabs: { enabled: false } }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: root.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    const wait = { maxPasses: 200 }
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Models (2)") &&
        frame.includes("Terminal Bench 2.0") &&
        frame.includes("MCP") &&
        frame.includes("Balance"),
      wait,
    )
    await setup.waitForVisualIdle()
    const lines = setup.captureCharFrame().split("\n")
    const row = (text: string) => lines.findIndex((line) => line.includes(text))
    // v1 order: Context 100, usage 150, MCP 200.
    expect(row("Context")).toBeLessThan(row("Token Usage"))
    expect(row("Token Usage")).toBeLessThan(row("Models (2)"))
    expect(row("Terminal Bench 2.0")).toBeLessThan(row("MCP"))
    // v1 footer order: Kilo balance 99, upstream footer (location path) 100, Kilo version last.
    const sidebar = lines.map((line) => line.slice(120))
    const path = sidebar.findIndex((line) => line.includes("/tmp/opencode/packages/tui:main"))
    expect(row("Balance")).toBeLessThan(path)
    expect(path).toBeLessThan(sidebar.findIndex((line) => line.includes("• Kilo test")))
    const frame = lines.join("\n")
    expect(frame).toMatch(/• Personal credits\s+\$1\.50/)
    // Three steps over two pages each: the totals cover the root and the subagent.
    expect(frame).toMatch(/Input\s+3,000/)
    expect(frame).toMatch(/Cache rate\s+50\.0%/)
    expect(frame).toMatch(/Generation speed\s+200 t\/s/)
    expect(frame).toMatch(/Cost\s+\$0\.35/)
    expect(row("Kilo Gateway")).toBeLessThan(row("OpenAI"))
    expect(frame).toMatch(/▶ Claude Sonnet 4\.6\s+2\s+\$0\.30/)
    expect(frame).toMatch(/▶ GPT-5\.4\s+1\s+\$0\.05/)
    expect(frame).toMatch(/Completion\s+61\.0%/)
    expect(frame).toMatch(/Cost \/ attempt\s+\$2\.10/)
    await setup.mockMouse.click(lines[row("▶ Claude Sonnet 4.6")].indexOf("▶"), row("▶ Claude Sonnet 4.6"))
    await setup.waitForFrame((next) => next.includes("▼ Claude Sonnet 4.6"), wait)
    expect(setup.captureCharFrame()).toMatch(/▼ Claude Sonnet 4\.6[\s\S]*Input\s+2,000/)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
