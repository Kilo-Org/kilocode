import { test, expect, mock, beforeEach } from "bun:test"
import { EventEmitter } from "events"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

// Track open() calls and control failure behavior
let openShouldFail = false
let openCalledWith: string | undefined

void mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url

    // Return a mock subprocess that emits an error if openShouldFail is true
    const subprocess = new EventEmitter()
    if (openShouldFail) {
      // kilocode_change start - buffer the error until the consumer attaches
      // its listener. The previous setTimeout(10) raced listener attachment
      // on slow Windows CI; emit() before `.on("error", ...)` was silently
      // lost and BrowserOpenFailed was never published.
      const err = new Error("spawn xdg-open ENOENT")
      const originalOn = subprocess.on.bind(subprocess)
      subprocess.on = function (event, listener) {
        const ret = originalOn(event, listener)
        if (event === "error") queueMicrotask(() => (listener as (e: Error) => void).call(subprocess, err))
        return ret
      }
      // kilocode_change end
    }
    return subprocess
  },
}))

// Mock UnauthorizedError
class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []

// Mock the transport constructors
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    url: string
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    constructor(url: URL, options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> } }) {
      this.url = url.toString()
      this.authProvider = options?.authProvider
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      // Simulate OAuth redirect by calling the authProvider's redirectToAuthorization
      if (this.authProvider?.redirectToAuthorization) {
        await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?client_id=test"))
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      // Mock successful auth completion
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: {},
      })
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
  },
}))

// Mock the MCP SDK Client to trigger OAuth flow
void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
  },
}))

// kilocode_change start - reset mock state and wait for OAuth redirect signal in CI
// Mock UnauthorizedError in the auth module
void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  openShouldFail = false
  openCalledWith = undefined
  transportCalls.length = 0
})

async function waitFor(fn: () => boolean, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (!fn() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
// kilocode_change end

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { Bus } = await import("../../src/bus")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const service = MCP.Service as unknown as Effect.Effect<MCPNS.Interface, never, never>

test("BrowserOpenFailed event is published when open() throws", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          mcp: {
            "test-oauth-server": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      openShouldFail = true

      const events: Array<{ mcpName: string; url: string }> = []
      const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
        events.push(evt.properties)
      }) // kilocode_change

      // kilocode_change start - attach rejection handler before stopping callback server
      // Run authenticate with a timeout to avoid waiting forever for the callback
      // Attach a handler immediately so callback shutdown rejections
      // don't show up as unhandled between tests.
      const authPromise = AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
          return yield* mcp.authenticate("test-oauth-server")
        }),
      ).catch(() => undefined)
      // kilocode_change end

      await waitFor(() => events.length > 0) // kilocode_change

      // Stop the callback server and cancel any pending auth
      await McpOAuthCallback.stop()

      await authPromise

      unsubscribe()

      // Verify the BrowserOpenFailed event was published
      expect(events.length).toBe(1)
      expect(events[0].mcpName).toBe("test-oauth-server")
      expect(events[0].url).toContain("https://")
    },
  })
})

test("BrowserOpenFailed event is NOT published when open() succeeds", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          mcp: {
            "test-oauth-server-2": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => { // kilocode_change
      openShouldFail = false // kilocode_change

      const events: Array<{ mcpName: string; url: string }> = []
      const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
        events.push(evt.properties)
      }) // kilocode_change

      // kilocode_change start - attach rejection handler before stopping callback server
      // Run authenticate with a timeout to avoid waiting forever for the callback
      const authPromise = AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
          return yield* mcp.authenticate("test-oauth-server-2")
        }),
      ).catch(() => undefined)
      // kilocode_change end

      await waitFor(() => openCalledWith !== undefined) // kilocode_change
      await new Promise((resolve) => setTimeout(resolve, 600)) // kilocode_change - let authenticate await callbackPromise before stop rejects it

      // Stop the callback server and cancel any pending auth
      await McpOAuthCallback.stop()

      await authPromise

      unsubscribe()

      // Verify NO BrowserOpenFailed event was published
      expect(events.length).toBe(0)
      // Verify open() was still called
      expect(openCalledWith).toBeDefined()
    },
  })
})

test("open() is called with the authorization URL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          mcp: {
            "test-oauth-server-3": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => { // kilocode_change
      openShouldFail = false // kilocode_change
      openCalledWith = undefined

      // kilocode_change start - attach rejection handler before stopping callback server
      // Run authenticate with a timeout to avoid waiting forever for the callback
      const authPromise = AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
          return yield* mcp.authenticate("test-oauth-server-3")
        }),
      ).catch(() => undefined)
      // kilocode_change end

      await waitFor(() => openCalledWith !== undefined) // kilocode_change
      await new Promise((resolve) => setTimeout(resolve, 600)) // kilocode_change - let authenticate await callbackPromise before stop rejects it

      // Stop the callback server and cancel any pending auth
      await McpOAuthCallback.stop()

      await authPromise

      // Verify open was called with a URL
      expect(openCalledWith).toBeDefined()
      expect(typeof openCalledWith).toBe("string")
      expect(openCalledWith!).toContain("https://")
    },
  })
})
