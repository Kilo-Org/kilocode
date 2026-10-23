import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

test("/usage shows the session family, provider plans and BYOK keys, and refreshes", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 110, height: 50, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const model = { providerID: "kilo", id: "kilo-auto/free" }
  const info = (id: string, cost: number, parentID?: string) => ({
    id,
    ...(parentID ? { parentID } : {}),
    title: id,
    projectID: "proj_test",
    location: { directory },
    agent: "build",
    model,
    cost,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 100, write: 0 } },
    time: { created: 0, updated: 10 },
  })
  const root = info("ses_usage_root", 0.3)
  const child = info("ses_usage_child", 0.2, root.id)
  const step = (id: string, output: number, elapsed: number): SessionMessageInfo => ({
    type: "assistant",
    id,
    agent: "build",
    model,
    finish: "stop",
    content: [{ type: "text", text: "Done" }],
    tokens: { input: 100, output, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_000, completed: 1_000 + elapsed },
  })
  const messages: Record<string, SessionMessageInfo[]> = {
    [root.id]: [{ type: "user", id: "msg_user", text: "Check usage", time: { created: 0 } }, step("msg_root", 100, 1_000)],
    [child.id]: [step("msg_child", 300, 3_000)],
  }
  const rpc: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session")
      return json({ data: url.searchParams.get("parentID") === root.id ? [child] : [root], cursor: {} })
    for (const session of [root, child]) {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages[session.id].toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    }
    if (url.pathname.startsWith("/api/rpc/")) rpc.push(url.pathname)
    if (url.pathname === "/api/rpc/kilocode.gateway/byok")
      return json({ output: [{ id: "byok-1", provider_id: "anthropic", management_source: "coding_plan", is_enabled: true }] })
    if (url.pathname.startsWith("/api/rpc/kilocode.provider-usage/"))
      return json({
        output: {
          generatedAt: "2026-10-14T12:00:00Z",
          items: [
            {
              id: "kilo-managed:sub-1",
              providerID: "anthropic",
              sourceKind: "kilo_managed",
              providerLabel: "Anthropic",
              planLabel: "Kilo Coding Plan Pro",
              sourceLabel: "via Kilo",
              fetchState: "ready",
              planState: "active",
              routingState: "active",
              managementUrl: "https://app.kilo.ai/subscriptions/coding-plans/sub-1",
              windows: [
                {
                  id: "sub-1:five_hour",
                  resource: "subscription",
                  unit: "percent",
                  orientation: "remaining_percent",
                  remaining: 75,
                  period: { unit: "hour", value: 5 },
                  state: "active",
                },
              ],
            },
            {
              id: "codex-chatgpt",
              providerID: "openai",
              sourceKind: "direct",
              providerLabel: "OpenAI",
              planLabel: "ChatGPT Codex",
              sourceLabel: "ChatGPT OAuth",
              fetchState: "unavailable",
              planState: "unknown",
              routingState: "not_applicable",
              windows: [],
              error: { code: "codex_auth_unavailable", message: "Reconnect ChatGPT to view Codex usage.", retryable: false },
            },
          ],
        },
      })
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
    await setup.waitForFrame((frame) => frame.includes("Check usage"), wait)
    await setup.mockInput.typeText("/usage")
    await setup.waitForFrame((frame) => frame.includes("View session usage"), wait)
    setup.mockInput.pressKey("RETURN")
    await setup.waitForFrame(
      (frame) => frame.includes("Kilo Coding Plan Pro") && frame.includes("BYOK keys") && frame.includes("100 t/s"),
      wait,
    )
    const frame = setup.captureCharFrame()
    // Family cost and speed: (100 + 300) tokens over (1 + 3) seconds of generation.
    expect(frame).toMatch(/Cost \(incl\. 1 subagents\)\s+\$0\.50/)
    expect(frame).toMatch(/Input tokens\s+200/)
    expect(frame).toMatch(/Cache hit rate\s+50\.0%/)
    expect(frame).toContain("Anthropic - Kilo Coding Plan Pro")
    expect(frame).toContain("5-hour quota: 75% remaining")
    expect(frame).toContain("https://app.kilo.ai/subscriptions/coding-plans/sub-1")
    expect(frame).toContain("Reconnect ChatGPT to view Codex usage.")
    expect(frame).toMatch(/anthropic\s+enabled · coding plan/)
    expect(rpc).toContain("/api/rpc/kilocode.provider-usage/get")
    setup.mockInput.pressKey("r", { ctrl: true })
    await setup.waitForVisualIdle()
    expect(rpc).toContain("/api/rpc/kilocode.provider-usage/refresh")
    setup.mockInput.pressKey("ESCAPE")
    await setup.waitForFrame((frame) => !frame.includes("Plans & usage"), wait)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
