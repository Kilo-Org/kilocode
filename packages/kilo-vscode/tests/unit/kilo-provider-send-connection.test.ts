import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { setImmediate as tick } from "node:timers/promises"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { KiloProvider } from "../../src/KiloProvider"
import { KiloConnectionService, type ConnectionState } from "../../src/services/cli-backend/connection-service"
import { generateFim } from "../../src/services/autocomplete/fim"
import { SdkSSEAdapter } from "../../src/services/cli-backend/sdk-sse-adapter"

const resources: { dispose(): void }[] = []

afterEach(() => {
  for (const resource of resources.splice(0).reverse()) resource.dispose()
})

type Backend = {
  client: KiloClient | null
  sseClient: SdkSSEAdapter | null
  state: ConnectionState
  stateListeners: Set<unknown>
  setState(state: ConnectionState, error?: Error): void
  handleServerExit(code: number): void
  serverManager: { getServer(): Promise<never> }
}

type Provider = {
  isWebviewReady: boolean
  webview: { postMessage(message: unknown): Promise<void> }
  retryAbortControllers: Map<string, AbortController>
  handleSendMessage(
    text: string,
    messageID?: string,
    sessionID?: string,
    draftID?: string,
    providerID?: string,
    modelID?: string,
  ): Promise<void>
  handleSendCommand(command: string, args: string, messageID?: string, sessionID?: string): Promise<void>
  cancelRetry(sid: string): void
  sends: Set<AbortController>
}

function setup(dir = "/repo/origin") {
  const preparing = Promise.withResolvers<void>()
  const prepared = Promise.withResolvers<void>()
  const connection = new KiloConnectionService({} as never, undefined, async () => {
    preparing.resolve()
    await prepared.promise
  })
  resources.push(connection)
  const prompts: Record<string, unknown>[] = []
  const commands: Record<string, unknown>[] = []
  const client = {
    config: { get: async () => ({ data: {} }) },
    session: {
      promptAsync: async (input: Record<string, unknown>) => {
        prompts.push(input)
        return {}
      },
      command: async (input: Record<string, unknown>) => {
        commands.push(input)
        return {}
      },
    },
  } as unknown as KiloClient
  const backend = connection as unknown as Backend
  backend.client = client
  backend.sseClient = new SdkSSEAdapter(client)
  backend.state = "connected"
  const provider = new KiloProvider({} as never, connection, undefined, { rootDirectory: () => "/another/project" })
  resources.push(provider)
  provider.setSessionDirectory("s1", dir)
  const internal = provider as unknown as Provider
  const sent: unknown[] = []
  internal.isWebviewReady = true
  internal.webview = { postMessage: async (message) => void sent.push(message) }
  return { connection, backend, client, provider, internal, prompts, commands, sent, preparing, prepared }
}

describe("sending during local SSE recovery", () => {
  it.each(["/repo/origin", "D:\\项目 空间\\website", "\\\\server\\share\\project"])(
    "keeps the original session and directory after preparation: %s",
    async (directory) => {
      const test = setup(directory)
      const pending = test.internal.handleSendMessage("继续", "m1", "s1", undefined, "custom", "model")
      await test.preparing.promise
      test.backend.setState("connecting")
      test.prepared.resolve()
      await tick()
      expect(test.prompts).toEqual([])

      test.backend.setState("connected")
      await pending
      expect(test.prompts).toHaveLength(1)
      expect(test.prompts[0]).toMatchObject({
        sessionID: "s1",
        directory,
        messageID: "m1",
        model: { providerID: "custom", modelID: "model" },
        parts: [expect.objectContaining({ type: "text", text: "继续" })],
      })
      expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
    },
  )

  it("waits if the stream is already reconnecting when Send is clicked", async () => {
    const test = setup()
    test.backend.setState("connecting")
    test.prepared.resolve()
    const pending = test.internal.handleSendMessage("hello", undefined, "s1")
    await Promise.resolve()
    expect(test.prompts).toEqual([])
    test.backend.setState("connected")
    await pending
    expect(test.prompts).toHaveLength(1)
    expect(test.prompts[0]).toMatchObject({ sessionID: "s1", directory: "/repo/origin" })
  })

  it("also recovers slash commands after tool preparation", async () => {
    const test = setup("C:\\work\\demo")
    const pending = test.internal.handleSendCommand("compact", "", "m1", "s1")
    await test.preparing.promise
    test.backend.setState("connecting")
    test.prepared.resolve()
    await tick()
    expect(test.commands).toEqual([])
    test.backend.setState("connected")
    await pending
    expect(test.commands).toEqual([
      expect.objectContaining({ sessionID: "s1", directory: "C:\\work\\demo", command: "compact", messageID: "m1" }),
    ])
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
  })

  it.each([false, true])("does not submit a stopped message (recovered before stop: %s)", async (recovered) => {
    const test = setup()
    const pending = test.internal.handleSendMessage("hello", "m1", "s1")
    await test.preparing.promise
    test.backend.setState("connecting")
    test.prepared.resolve()
    await tick()
    expect(test.internal.retryAbortControllers.has("s1")).toBe(true)
    if (recovered) test.backend.setState("connected")
    test.internal.cancelRetry("s1")
    await pending
    test.backend.setState("connected")
    expect(test.prompts).toEqual([])
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
  })

  it.each(["message", "command"] as const)("stops a %s while its initial connection is recovering", async (kind) => {
    const test = setup()
    test.backend.setState("connecting")
    test.prepared.resolve()
    const pending =
      kind === "message"
        ? test.internal.handleSendMessage("hello", "m1", "s1")
        : test.internal.handleSendCommand("compact", "", "m1", "s1")
    test.internal.cancelRetry("s1")
    await pending
    test.backend.setState("connected")
    expect(test.prompts).toEqual([])
    expect(test.commands).toEqual([])
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
    expect(test.backend.stateListeners.size).toBe(0)
  })

  it.each(["message", "command"] as const)("stops a %s while tools are still preparing", async (kind) => {
    const test = setup()
    const pending =
      kind === "message"
        ? test.internal.handleSendMessage("hello", "m1", "s1")
        : test.internal.handleSendCommand("compact", "", "m1", "s1")
    await test.preparing.promise
    test.internal.cancelRetry("s1")
    test.prepared.resolve()
    await pending
    expect(test.prompts).toEqual([])
    expect(test.commands).toEqual([])
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
  })

  it("does not create a draft that was closed during initial SSE recovery", async () => {
    const test = setup()
    test.backend.setState("connecting")
    const pending = test.internal.handleSendMessage("hello", "m1", undefined, "pending:draft-1")
    await test.provider.abortSessions(["pending:draft-1"])
    test.backend.setState("connected")
    await pending
    expect(test.prompts).toEqual([])
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sessionCreated" }))
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
  })

  it.each(["message", "command", "goal"] as const)(
    "cancels a queued %s when its provider is disposed, including drafts without session IDs",
    async (kind) => {
      const test = setup()
      const sibling = new KiloProvider({} as never, test.connection)
      resources.push(sibling)
      test.backend.setState("connecting")
      test.prepared.resolve()
      const create = spyOn(test.client.session, "create").mockRejectedValue(new Error("Unexpected session creation"))
      const pending =
        kind === "message"
          ? test.internal.handleSendMessage("hello", "m1", undefined, "draft-1")
          : test.internal.handleSendCommand(kind === "goal" ? "goal" : "compact", "", "m1")
      expect(test.internal.sends.size).toBe(1)
      test.provider.dispose()
      await pending
      test.backend.setState("connected")
      expect(create).not.toHaveBeenCalled()
      expect(test.prompts).toEqual([])
      expect(test.commands).toEqual([])
      expect(test.internal.sends.size).toBe(0)
      expect(test.internal.retryAbortControllers.size).toBe(0)
      expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
      expect(test.connection.getClient()).toBe(test.client)
      create.mockRestore()
    },
  )

  it.each(["message", "command"] as const)(
    "cancels every preparing %s for the same session on disposal",
    async (kind) => {
      const test = setup()
      const send = () =>
        kind === "message"
          ? test.internal.handleSendMessage("hello", "m1", "s1")
          : test.internal.handleSendCommand("compact", "", "m1", "s1")
      const pending = Promise.all([send(), send()])
      await test.preparing.promise
      expect(test.internal.sends.size).toBe(2)
      test.provider.dispose()
      test.prepared.resolve()
      await pending
      expect(test.prompts).toEqual([])
      expect(test.commands).toEqual([])
      expect(test.internal.sends.size).toBe(0)
      expect(test.internal.retryAbortControllers.size).toBe(0)
    },
  )

  it("does not create a session if disposed during sandbox preparation", async () => {
    const test = setup()
    const preparing = Promise.withResolvers<void>()
    const prepared = Promise.withResolvers<Awaited<ReturnType<KiloClient["config"]["get"]>>>()
    test.client.config.get = async () => {
      preparing.resolve()
      return prepared.promise
    }
    const create = spyOn(test.client.session, "create").mockRejectedValue(new Error("Unexpected session creation"))
    const pending = test.internal.handleSendMessage("hello", "m1", undefined, "draft-1")
    await preparing.promise
    test.provider.dispose()
    prepared.resolve({ data: {} } as Awaited<ReturnType<KiloClient["config"]["get"]>>)
    await pending
    expect(create).not.toHaveBeenCalled()
    expect(test.prompts).toEqual([])
    expect(test.internal.sends.size).toBe(0)
    create.mockRestore()
  })

  it("keeps the running goal's cancellation ownership while its control command waits", async () => {
    const test = setup()
    const controller = new AbortController()
    test.internal.retryAbortControllers.set("s1", controller)
    test.backend.setState("connecting")
    const pending = test.internal.handleSendCommand("goal", "pause", "m1", "s1")
    expect(test.internal.retryAbortControllers.get("s1")).toBe(controller)
    expect(controller.signal.aborted).toBe(false)
    test.backend.setState("connected")
    await pending
    expect(test.commands).toHaveLength(1)
    expect(test.internal.retryAbortControllers.get("s1")).toBe(controller)
    expect(controller.signal.aborted).toBe(false)
    expect(test.internal.sends.size).toBe(0)
  })

  it("preserves the existing send path and optional arguments while connected", async () => {
    const test = setup()
    test.prepared.resolve()
    await test.internal.handleSendMessage("legacy", undefined, "s1")
    expect(test.prompts).toHaveLength(1)
    expect(test.prompts[0]).toMatchObject({ sessionID: "s1", directory: "/repo/origin", model: undefined })
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
  })

  it("keeps a captured client when a new session loses SSE during sandbox preparation", async () => {
    const test = setup()
    const created: unknown[] = []
    test.client.config.get = async () => {
      test.backend.setState("connecting")
      return { data: {} } as Awaited<ReturnType<KiloClient["config"]["get"]>>
    }
    test.client.session.create = async (input) => {
      created.push(input)
      return {
        data: { id: "created", directory: "/another/project", title: "New", time: { created: 1, updated: 1 } },
      } as Awaited<ReturnType<KiloClient["session"]["create"]>>
    }
    const pending = test.internal.handleSendMessage("new", "m1", undefined, "draft-1")
    await test.preparing.promise
    expect(created).toHaveLength(1)
    test.prepared.resolve()
    await tick()
    expect(test.prompts).toEqual([])
    test.backend.setState("connected")
    await pending
    expect(test.prompts).toEqual([
      expect.objectContaining({ sessionID: "created", directory: "/another/project", messageID: "m1" }),
    ])
    expect(test.sent).toContainEqual(expect.objectContaining({ type: "sessionCreated", draftID: "draft-1" }))
    expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
  })

  it("reacquires a ready client on a later HTTP retry while keeping the message ID", async () => {
    const test = setup()
    const waiting = Promise.withResolvers<void>()
    const acquire = test.connection.getClientAsync.bind(test.connection)
    const spy = spyOn(test.connection, "getClientAsync").mockImplementation((dir, signal, wait) => {
      waiting.resolve()
      return acquire(dir, signal, wait)
    })
    test.client.session.promptAsync = async (input) => {
      test.prompts.push(input)
      if (test.prompts.length > 1) return {} as Awaited<ReturnType<KiloClient["session"]["promptAsync"]>>
      test.backend.setState("connecting")
      return {
        error: "temporarily unavailable",
        response: new Response(null, { status: 503, headers: { "retry-after-ms": "1" } }),
      } as Awaited<ReturnType<KiloClient["session"]["promptAsync"]>>
    }
    test.prepared.resolve()
    try {
      const pending = test.internal.handleSendMessage("retry", "m1", "s1")
      await waiting.promise
      expect(test.prompts).toHaveLength(1)
      test.backend.setState("connected")
      await pending
      expect(test.prompts).toHaveLength(2)
      expect(test.prompts[1]).toEqual(test.prompts[0])
      expect(test.sent).not.toContainEqual(expect.objectContaining({ type: "sendMessageFailed" }))
    } finally {
      spy.mockRestore()
    }
  })
})

describe("shared client waits", () => {
  it("shares SSE recovery without replacing the backend or its event adapter", async () => {
    const test = setup()
    const sse = test.backend.sseClient
    const server = spyOn(test.backend.serverManager, "getServer").mockRejectedValue(new Error("Unexpected restart"))
    test.backend.setState("connecting")
    const pending = Promise.all([
      test.connection.getClientAsync(undefined, undefined, true),
      test.connection.getClientAsync("D:\\work\\demo", undefined, true),
    ])
    test.backend.setState("error", new Error("temporary stream failure"))
    test.backend.setState("connecting")
    test.backend.setState("connected")
    expect(await pending).toEqual([test.client, test.client])
    expect(test.backend.sseClient).toBe(sse)
    expect(server).not.toHaveBeenCalled()
    expect(test.backend.stateListeners.size).toBe(0)
    server.mockRestore()
  })

  it.each(["connecting", "error"] as const)(
    "fails background acquisition promptly while %s without resetting SSE",
    async (state) => {
      const test = setup()
      const sse = test.backend.sseClient
      const failure = new Error("SSE socket closed")
      test.backend.setState(state, state === "error" ? failure : undefined)
      const timer = spyOn(AbortSignal, "timeout")
      const server = spyOn(test.backend.serverManager, "getServer")
      try {
        await expect(test.connection.getClientAsync("C:\\work\\demo")).rejects.toThrow(
          state === "error" ? failure.message : "CLI event stream is reconnecting",
        )
        await expect(generateFim(test.connection, "codestral", "prefix", "suffix", () => {})).rejects.toThrow()
        expect(timer).not.toHaveBeenCalled()
        expect(server).not.toHaveBeenCalled()
        expect(test.backend.sseClient).toBe(sse)
        expect(test.backend.stateListeners.size).toBe(0)
      } finally {
        timer.mockRestore()
        server.mockRestore()
      }
    },
  )

  it("preserves the underlying error if an explicit reconnect fails", async () => {
    const test = setup()
    const failure = new Error("Backend health check failed")
    test.backend.setState("error", new Error("Stale stream error"))
    const server = spyOn(test.backend.serverManager, "getServer").mockRejectedValue(failure)
    try {
      await expect(test.connection.connect("C:\\work\\demo")).rejects.toBe(failure)
      expect(server).toHaveBeenCalledTimes(1)
      expect(test.connection.getConnectionError()).toBe(failure)
      expect(test.backend.sseClient).toBeNull()
    } finally {
      server.mockRestore()
    }
  })

  it("allows a caller deadline to cancel only its own recovery wait", async () => {
    const test = setup()
    const controller = new AbortController()
    test.backend.setState("connecting")
    const pending = test.connection.getClientAsync(undefined, controller.signal, true)
    const sibling = test.connection.getClientAsync(undefined, undefined, true)
    const failure = new Error("Caller deadline exceeded")
    controller.abort(failure)
    await expect(pending).rejects.toBe(failure)
    expect(test.backend.stateListeners.size).toBe(1)
    test.backend.setState("connected")
    expect(await sibling).toBe(test.client)
    expect(test.backend.stateListeners.size).toBe(0)
  })

  it("fails promptly when the Agent process exits instead of returning a stale client", async () => {
    const test = setup()
    test.backend.setState("connecting")
    const pending = test.connection.getClientAsync(undefined, undefined, true)
    test.backend.handleServerExit(9)
    await expect(pending).rejects.toThrow("CLI background process exited")
    expect(() => test.connection.getClient()).toThrow("Not connected")
    expect(test.backend.stateListeners.size).toBe(0)
  })

  it("bounds recovery waits and removes listeners after timing out", async () => {
    const test = setup()
    const controller = new AbortController()
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    try {
      const failure = new Error("SSE socket closed")
      test.backend.setState("error", failure)
      test.backend.setState("connecting")
      const pending = test.connection.getClientAsync(undefined, undefined, true)
      controller.abort()
      await expect(pending).rejects.toThrow("Timed out waiting for CLI event stream to reconnect: SSE socket closed")
      await expect(pending).rejects.toMatchObject({ cause: failure })
      expect(test.backend.stateListeners.size).toBe(0)
    } finally {
      timeout.mockRestore()
    }
  })

  it("releases waiting clients when the extension is disposed", async () => {
    const test = setup()
    test.backend.setState("connecting")
    const pending = test.connection.getClientAsync(undefined, undefined, true)
    test.connection.dispose()
    await expect(pending).rejects.toThrow("CLI connection service disposed")
    expect(test.backend.stateListeners.size).toBe(0)
  })
})
