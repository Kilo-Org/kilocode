import { afterEach, describe, expect, it, jest } from "bun:test"
import { OpenCode, type ModelInfo } from "@opencode/client"
import { createData } from "@opencode/client/solid"
import { createRoot } from "solid-js"
import { setImmediate } from "node:timers/promises"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { events } from "../webview-ui/src/v2/events"
import { startFromTool, type ToolDeps } from "../src/agent-manager/tool-start"
import { createSessionInWorktree } from "../src/agent-manager/provider-session"
import {
  dispatchInitialPrompt,
  initialCommand,
  initialMessage,
  initialModel,
} from "../webview-ui/agent-manager/initial-message"

function store() {
  const calls: unknown[][] = []
  return {
    calls,
    value: {
      directory: "/worktree",
      api: {
        command: { list: async () => ({ data: [] }) },
        model: {
          list: async () => ({
            data: [
              {
                providerID: "anthropic",
                id: "claude-sonnet-4",
                enabled: true,
                capabilities: { input: ["text"], output: ["text"] },
              },
            ],
          }),
        },
        session: {
          switchAgent: async (input: unknown) => void calls.push(["switchAgent", input]),
          switchModel: async (input: unknown) => void calls.push(["switchModel", input]),
          command: async (input: unknown) => void calls.push(["command", input]),
        },
      },
      data: { session: { get: () => undefined, prompt: (input: unknown) => void calls.push(["prompt", input]) } },
    },
  }
}

const base = {
  type: "agentManager.sendInitialMessage" as const,
  sessionId: "session-a",
  worktreeId: "wt-a",
}

afterEach(() => jest.useRealTimers())

function catalogStore() {
  const requests: { path: string; directory: string | null; body?: unknown }[] = []
  const catalog: {
    models: ModelInfo[]
    failure: KiloGatewayRpc.CatalogFailure | null
    commandModel?: string
    rejected?: boolean
  } = {
    models: [],
    failure: null,
  }
  const api = OpenCode.make({
    baseUrl: "http://kilo.invalid",
    fetch: Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = new Request(...args)
        const url = new URL(request.url)
        const body = request.method === "POST" ? await request.json() : undefined
        requests.push({ path: url.pathname, directory: url.searchParams.get("location[directory]"), body })
        if (url.pathname === "/api/model")
          return Response.json({
            location: { directory: "/worktree" },
            data: url.searchParams.get("location[directory]") === "/root" ? [selected] : catalog.models,
          })
        if (url.pathname === "/api/session")
          return Response.json({
            data: {
              id: "session-a",
              projectID: "project",
              location: { directory: "/worktree" },
              time: { created: 1, updated: 1 },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          })
        if (["/api/config", "/api/agent", "/api/mcp"].includes(url.pathname)) return Response.json({ data: [] })
        if (url.pathname === "/api/plugin")
          return Response.json({ data: [{ id: "kilocode.gateway", status: "active" }] })
        if (url.pathname === "/api/rpc/kilocode.gateway/catalog.status")
          return Response.json({ output: { failure: catalog.failure } })
        if (url.pathname === "/api/command")
          return Response.json({ data: [{ name: "goal", model: catalog.commandModel }] })
        if (catalog.rejected && url.pathname.endsWith("/model"))
          return Response.json({ _tag: "NotFoundError", message: "Model unavailable: kilo/delayed" }, { status: 404 })
        if (url.pathname.endsWith("/prompt")) return Response.json({ data: {} })
        return new Response(null, { status: 204 })
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return createRoot((dispose) => ({
    catalog,
    requests,
    writes: () => requests.filter((request) => request.path.startsWith("/api/session")),
    value: {
      api,
      directory: "/worktree",
      data: createData({ api: () => api, directory: "/worktree", event: events() }),
    },
    [Symbol.dispose]: dispose,
  }))
}

const selected = {
  providerID: "kilo",
  id: "delayed",
  enabled: true,
  capabilities: { input: ["text"], output: ["text"] },
} as ModelInfo

it("waits for the target worktree's selected model before switching or admitting its initial prompt", async () => {
  jest.useFakeTimers()
  using ctx = catalogStore()
  const pending = dispatchInitialPrompt(ctx.value as never, {
    ...base,
    text: "One initial prompt",
    providerID: selected.providerID,
    modelID: selected.id,
    variant: "high",
  })
  await setImmediate()
  try {
    expect(ctx.writes()).toEqual([])
    expect(ctx.requests.some((request) => request.path === "/api/model" && request.directory === "/worktree")).toBe(
      true,
    )
    ctx.catalog.models = [selected]
    jest.advanceTimersToNextTimer()
    await pending
    expect(ctx.writes().map((request) => request.path)).toEqual([
      "/api/session/session-a/model",
      "/api/session/session-a/prompt",
    ])
    expect(ctx.writes()[0]?.body).toEqual({ model: { providerID: "kilo", id: "delayed", variant: "high" } })
    jest.runOnlyPendingTimers()
    await setImmediate()
    expect(ctx.writes()).toHaveLength(2)
  } finally {
    ctx.catalog.models = [selected]
    jest.runOnlyPendingTimers()
    await pending
  }
})

it("cancels a pending initial prompt before any model switch or admission", async () => {
  jest.useFakeTimers()
  using ctx = catalogStore()
  const controller = new AbortController()
  const pending = dispatchInitialPrompt(
    ctx.value as never,
    {
      ...base,
      text: "Do not send",
      providerID: "kilo",
      modelID: "delayed",
    },
    controller.signal,
  )
  await setImmediate()
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  ctx.catalog.models = [selected]
  jest.runAllTimers()
  await setImmediate()
  expect(ctx.writes()).toEqual([])
})

it("preserves a genuine unavailable-model failure without retrying or changing the selection", async () => {
  using ctx = catalogStore()
  ctx.catalog.models = [{ ...selected, id: "another" }]
  ctx.catalog.rejected = true
  await expect(
    dispatchInitialPrompt(ctx.value as never, {
      ...base,
      text: "Fix it",
      providerID: "kilo",
      modelID: "delayed",
    }),
  ).rejects.toThrow("Model unavailable: kilo/delayed")
  expect(ctx.writes()).toHaveLength(1)
  expect(ctx.writes()[0]?.body).toEqual({ model: { providerID: "kilo", id: "delayed" } })
})

it("a failed catalog reaches the native error path rather than retrying an admitted prompt", async () => {
  using ctx = catalogStore()
  ctx.catalog.failure = { kind: "network" }
  await dispatchInitialPrompt(ctx.value as never, { ...base, text: "Fix it", providerID: "kilo", modelID: "delayed" })
  expect(ctx.requests.filter((request) => request.path === "/api/model")).toHaveLength(1)
  expect(ctx.writes().filter((request) => request.path.endsWith("/prompt"))).toHaveLength(1)
})

it("waits for an initial command's own model even when the selected provider is ready", async () => {
  jest.useFakeTimers()
  using ctx = catalogStore()
  ctx.catalog.models = [{ ...selected, providerID: "other", id: "ready" }]
  ctx.catalog.commandModel = "kilo/delayed"
  const pending = dispatchInitialPrompt(ctx.value as never, {
    ...base,
    command: "goal",
    arguments: "Ship it",
    providerID: "other",
    modelID: "ready",
  })
  await setImmediate()
  expect(ctx.writes()).toEqual([])
  ctx.catalog.models.push(selected)
  jest.advanceTimersToNextTimer()
  await pending
  expect(ctx.writes().map((request) => request.path)).toEqual(["/api/session/session-a/command"])
})

function toolHost(ctx: ReturnType<typeof catalogStore>, signal?: AbortSignal): ToolDeps {
  return {
    getClient: () => ctx.value.api,
    signal: () => signal,
    getRoot: () => "/root",
    getState: () =>
      ({
        addSession: () => undefined,
        getWorktree: () => ({ id: "wt", path: "/worktree" }),
        findWorktreeByPath: () => ({ id: "wt", path: "/worktree" }),
      }) as never,
    getPanel: () => undefined,
    openPanel: () => undefined,
    waitReady: async () => undefined,
    createWorktree: async () => ({ worktree: { id: "wt" }, result: { path: "/worktree", branch: "feature" } }) as never,
    cleanupWorktree: async () => undefined,
    hasScript: () => false,
    setup: async (_dir, _branch, _id, early) => {
      await early?.()
    },
    createSessionInWorktree: (dir, branch, id, _source, boot, timing, model, agent) =>
      createSessionInWorktree(
        {
          connection: { client: async () => ctx.value.api, signal: () => signal } as never,
          postToWebview: () => undefined,
          log: () => undefined,
        },
        dir,
        branch,
        id,
        timing,
        model,
        agent,
        boot,
      ),
    sessionMetadata: async () => ({}),
    registerWorktreeSession: () => undefined,
    notifyReady: () => undefined,
    push: () => undefined,
    post: () => undefined,
    log: () => undefined,
    error: () => undefined,
  }
}

it.each(["local", "worktree"] as const)(
  "host %s initial prompts wait for the target catalog before session creation",
  async (mode) => {
    jest.useFakeTimers()
    using ctx = catalogStore()
    expect((await ctx.value.api.model.list({ location: { directory: "/root" } })).data).toHaveLength(1)
    const pending = startFromTool(toolHost(ctx), {
      requestID: "request",
      mode,
      ...(mode === "local" ? { worktreeID: "wt", directory: "/root" } : {}),
      tasks: [{ prompt: "Host prompt", model: { providerID: "kilo", modelID: "delayed" }, variant: "high" }],
    })
    await setImmediate()
    expect(ctx.writes()).toEqual([])
    expect(ctx.requests.some((request) => request.path === "/api/model" && request.directory === "/worktree")).toBe(
      true,
    )
    ctx.catalog.models = [selected]
    jest.advanceTimersToNextTimer()
    await pending
    expect(ctx.writes().map((request) => request.path)).toEqual(["/api/session", "/api/session/session-a/prompt"])
    expect(ctx.writes()[0]?.body).toMatchObject({
      location: { directory: "/worktree" },
      model: { providerID: "kilo", id: "delayed", variant: "high" },
    })
  },
)

it("cancels host preparation before creating or admitting a local session", async () => {
  jest.useFakeTimers()
  using ctx = catalogStore()
  const controller = new AbortController()
  const pending = startFromTool(toolHost(ctx, controller.signal), {
    requestID: "cancelled",
    mode: "local",
    directory: "/root",
    worktreeID: "wt",
    tasks: [{ prompt: "Do not send", model: { providerID: "kilo", modelID: "delayed" } }],
  })
  await setImmediate()
  controller.abort()
  await pending
  ctx.catalog.models = [selected]
  jest.runAllTimers()
  await setImmediate()
  expect(ctx.writes()).toEqual([])
})

describe("dispatchInitialPrompt", () => {
  it("switches the agent and model, then runs a command prompt", async () => {
    const ctx = store()
    await dispatchInitialPrompt(ctx.value as never, {
      ...base,
      command: "goal",
      arguments: "ship it",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
    })

    expect(ctx.calls).toEqual([
      ["switchAgent", { sessionID: "session-a", agent: "code" }],
      [
        "switchModel",
        { sessionID: "session-a", model: { id: "claude-sonnet-4", providerID: "anthropic", variant: "high" } },
      ],
      ["command", { sessionID: "session-a", name: "goal", text: "ship it", files: undefined }],
    ])
  })

  it("submits a plain message for a text prompt", async () => {
    const ctx = store()
    await dispatchInitialPrompt(ctx.value as never, { ...base, text: "Fix it" })

    expect(ctx.calls).toEqual([["prompt", { sessionID: "session-a", text: "Fix it", files: undefined }]])
  })

  it("does nothing without text or a command", async () => {
    const ctx = store()
    await dispatchInitialPrompt(ctx.value as never, base)

    expect(ctx.calls).toHaveLength(0)
  })

  it("maps host files to v2 prompt files", () => {
    const message = initialMessage({
      ...base,
      text: "Fix it",
      files: [{ mime: "image/png", url: "data:image/png;base64,aaa" }],
    })
    expect(message?.files).toEqual([{ uri: "data:image/png;base64,aaa" }])
  })

  it("keeps the name and span of an @ mention file", () => {
    const mention = { text: "@Fix auth bug", start: 8, end: 21 }
    const message = initialMessage({
      ...base,
      text: "Compare @Fix auth bug",
      files: [{ mime: "text/plain", url: "session:ses_abc", name: "Fix-auth-bug.md", mention }],
    })
    expect(message?.files).toEqual([{ uri: "session:ses_abc", name: "Fix-auth-bug.md", mention }])
  })
})

describe("Agent Manager initial command", () => {
  it("builds a command request for a command initial prompt", () => {
    expect(
      initialCommand({
        ...base,
        command: "goal",
        arguments: "ship the release",
        files: [{ mime: "image/png", url: "data:image/png;base64,aaa" }],
      }),
    ).toEqual({
      sessionID: "session-a",
      name: "goal",
      text: "ship the release",
      files: [{ uri: "data:image/png;base64,aaa" }],
    })
  })

  it("defaults missing arguments to an empty string", () => {
    expect(initialCommand({ ...base, command: "grill" })?.text).toBe("")
  })

  it("returns undefined for a plain prompt", () => {
    expect(initialCommand({ ...base, text: "Fix it" })).toBeUndefined()
  })
})

describe("Agent Manager initial message", () => {
  it("keeps the requested variant on the model switch", () => {
    expect(
      initialModel({
        ...base,
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "high",
      }),
    ).toEqual({ id: "claude-sonnet-4", providerID: "anthropic", variant: "high" })
  })

  it("does not build a model without both ids", () => {
    expect(initialModel({ ...base, providerID: "anthropic" })).toBeUndefined()
  })

  it("does not create an empty message payload", () => {
    expect(initialMessage(base)).toBeUndefined()
  })
})
