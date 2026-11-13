import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import type {
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageToolStateCompleted,
} from "@opencode/client"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: "test", id: "test" }

function toolPart(
  id: string,
  name: string,
  input: SessionMessageToolStateCompleted["input"],
  title: string,
  output: string,
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id,
    name,
    state: { status: "completed", input, content: [{ type: "text", text: output }], metadata: { title } },
    time: { created: 1, completed: 2 },
  }
}

const messages: SessionMessageInfo[] = [
  { type: "user", id: "msg_user", text: "Find the test command", time: { created: 1 } },
  {
    type: "assistant",
    id: "msg_assistant",
    agent: "build",
    model,
    finish: "tool-calls",
    content: [
      toolPart(
        "tool_recall",
        "kilo_memory_recall",
        { mode: "search", query: "test command" },
        "Kilo memory search: 1 hit",
        "the test command is bun test",
      ),
      toolPart(
        "tool_save",
        "kilo_memory_save",
        { action: "remember", text: "we deploy with fly deploy" },
        "Kilo memory saved: 1 op",
        "saved",
      ),
    ],
    time: { created: 2, completed: 3 },
  },
]

const session = {
  id: "ses_memory",
  title: "Memory",
  projectID: "proj_test",
  location: { directory },
  agent: "build",
  model,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 10 },
}

const state = {
  version: 1,
  enabled: true,
  scope: "project",
  autoInject: true,
  autoConsolidate: true,
  verbose: false,
  capture: { mode: "selective", turnClose: true, explicit: true, maxOpsPerRun: 3, minIntervalMs: 0, timeoutMs: 1 },
  limits: {
    maxProjectIndexBytes: 1,
    maxSessionFiles: 1,
    maxRecentSessions: 1,
    maxConsolidationInputBytes: 1,
    maxLineChars: 1,
    maxSessionLineChars: 1,
  },
  stats: {
    lastInjectedAt: null,
    lastInjectedBytes: 0,
    lastInjectedTokens: 0,
    lastInjectedSessionID: null,
    lastTypedConsolidationAt: null,
    lastSessionSavedAt: null,
    lastConsolidatedMessageID: null,
    lastConsolidationCost: 0,
    lastConsolidationTokens: 0,
    lastOperationCount: 0,
    lastRecallAt: null,
    lastRecallCount: 0,
    lastRecallSessionID: null,
  },
}

test("renders memory tools, the sidebar row and runs typed /memory operations through the RPC", async () => {
  await using tmp = await tmpdir()
  const setup = await createTestRenderer({ width: 170, height: 50, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const calls: Array<{ method: string; input: unknown; directory: string | null }> = []

  const fetch = createFetch(async (url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (/^\/api\/session\/[^/]+\/inbox$/.test(url.pathname)) return json({ data: [] })
    if (url.pathname.startsWith("/api/rpc/kilocode.memory/")) {
      const method = url.pathname.split("/").at(-1)!
      const body = await request.json()
      calls.push({ method, input: body.input, directory: url.searchParams.get("location[directory]") })
      const index = { text: "", bytes: 0, tokens: 0, truncated: false }
      if (method === "status")
        return json({
          output: {
            root: "/memory",
            state,
            exists: { state: true, index: true },
            index: { bytes: 0, estimatedTokens: 0, preview: "" },
            marker: { type: "recall", tokens: 4, count: 1, files: ["project.md"] },
          },
        })
      if (method === "remember")
        return json({ output: { operationCount: 1, added: 1, removed: 0, skipped: [], index } })
      return json({ output: null })
    }
    if (url.pathname.startsWith("/api/rpc/")) return json({ output: null })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => fetch.fetch(request) })

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
    }).pipe(Effect.provide(Global.layerWith({ state: tmp.path })), Effect.provide(FileSystem.layerNoop({}))),
  )

  try {
    const transcript = await setup.waitForFrame(
      (frame) => frame.includes('Memory search "test command"') && frame.includes("• Enabled"),
      { maxPasses: 200 },
    )
    expect(transcript).toContain('◇ Memory search "test command" · 1 hit')
    expect(transcript).toContain('◇ Memory remember "we deploy with fly deploy" · 1 op')
    expect(transcript).not.toContain("kilo_memory_recall")
    expect(calls.find((call) => call.method === "status")).toEqual({
      method: "status",
      input: { sessionID: session.id },
      directory,
    })

    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.typeText("/memory remember the test command is bun test")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Memory saved · 1 change"), { maxPasses: 200 })
    expect(calls.find((call) => call.method === "remember")).toEqual({
      method: "remember",
      input: { sessionID: session.id, text: "the test command is bun test" },
      directory,
    })
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}, 30_000)
