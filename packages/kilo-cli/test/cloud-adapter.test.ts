import { describe, expect, test } from "bun:test"
import { createCloudAdapter } from "../src/cloud/client"
import { AgentStartRequestSchema, MessageIdSchema } from "../src/cloud/contracts"
import { CloudError } from "../src/cloud/errors"

// The adapter is the seam the host wires against: it receives an explicit
// resolved token/org/origin and must never consult a credential store, env var,
// or global. These tests stand up a loopback Bun.serve stub and assert the wire
// behaviour end to end. No live endpoint is contacted.

const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const ORG = "123e4567-e89b-12d3-a456-426614174000"
const TOKEN = "adapter-bearer-value"

function startRequest() {
  return {
    message: { prompt: "Inspect the repository" },
    agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
    repository: { type: "github", repo: "Kilo-Org/kilocode" },
    options: { createdOnPlatform: "kilo-cli" },
  } as const
}

function connection(server: { url: URL }) {
  return { token: TOKEN, agentOrigin: server.url.origin, webAppOrigin: server.url.origin }
}

// Loopback adapter factory for the local Bun.serve stub: opts into the HTTP
// loopback escape hatch so the production-strict origin guard accepts the stub.
function loopbackAdapter(server: { url: URL }, organizationId?: string) {
  return createCloudAdapter(
    { ...connection(server), ...(organizationId === undefined ? {} : { organizationId }) },
    { allowHttpLoopback: true },
  )
}

describe("createCloudAdapter", () => {
  test("requires a non-empty bearer token", () => {
    expect(() =>
      createCloudAdapter({ token: "", agentOrigin: "https://agent.example", webAppOrigin: "https://app.example" }),
    ).toThrow("A bearer token is required")
  })

  test("rejects a non-UUID organization ID before any request", () => {
    expect(() =>
      createCloudAdapter({
        token: TOKEN,
        organizationId: "not-a-uuid",
        agentOrigin: "https://agent.example",
        webAppOrigin: "https://app.example",
      }),
    ).toThrow("Kilo organization ID must be a valid UUID")
  })

  test("rejects an insecure non-loopback origin before any request", () => {
    expect(() =>
      createCloudAdapter({ token: TOKEN, agentOrigin: "http://agent.example", webAppOrigin: "https://app.example" }),
    ).toThrow("Service URL must use HTTPS unless it is an explicit loopback override")
  })

  test("injects the resolved organization into start and returns the admission", async () => {
    const bodies: unknown[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== "/trpc/start") return new Response(null, { status: 404 })
        const body = AgentStartRequestSchema.parse((await request.json()) as unknown)
        bodies.push(body)
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: SESSION,
              kiloSessionId: "ses_1",
              messageId: body.message.id,
              delivery: "queued",
            },
          },
        })
      },
    })

    try {
      const adapter = loopbackAdapter(server, ORG)
      const result = await adapter.start(startRequest())
      expect(result.cloudAgentSessionId).toBe(SESSION)
      expect(MessageIdSchema.safeParse(result.messageId).success).toBe(true)
      expect(bodies).toHaveLength(1)
      const sent = bodies[0] as { options: { kilocodeOrganizationId?: string } }
      expect(sent.options.kilocodeOrganizationId).toBe(ORG)
    } finally {
      await server.stop(true)
    }
  })

  test("omits the organization field entirely when none is resolved", async () => {
    const bodies: unknown[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = AgentStartRequestSchema.parse((await request.json()) as unknown)
        bodies.push(body)
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: SESSION,
              kiloSessionId: "ses_1",
              messageId: body.message.id,
              delivery: "queued",
            },
          },
        })
      },
    })

    try {
      const adapter = loopbackAdapter(server)
      await adapter.start(startRequest())
      const sent = bodies[0] as { options: Record<string, unknown> }
      expect("kilocodeOrganizationId" in sent.options).toBe(false)
    } finally {
      await server.stop(true)
    }
  })

  test("status projects the assistant payload away and result maps the exit code", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== "/trpc/getMessageResult") return new Response(null, { status: 404 })
        const raw = url.searchParams.get("input")
        const input = JSON.parse(raw ?? "null") as { cloudAgentSessionId: string; messageId: string }
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: input.cloudAgentSessionId,
              messageId: input.messageId,
              status: "completed",
              createdAt: 1,
              terminalAt: 2,
              completionSource: "runner",
              gateResult: "passed",
              assistant: { messageId: "msg_asst", text: "done" },
            },
          },
        })
      },
    })

    try {
      const adapter = loopbackAdapter(server)
      const input = { cloudAgentSessionId: SESSION, messageId: "msg_018f1e2d3c4bAbCdEfGhIjKlMn" }
      const status = await adapter.status(input)
      expect(status.status).toBe("completed")
      expect("assistant" in status).toBe(false)

      const { result, exitCode } = await adapter.result(input)
      expect(result.assistant?.text).toBe("done")
      expect(exitCode).toBe(0)
    } finally {
      await server.stop(true)
    }
  })

  test("maps terminal failure statuses to their exit codes", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        const input = JSON.parse(url.searchParams.get("input") ?? "null") as { messageId: string }
        const status = input.messageId.endsWith("AbCdEfGhIjKlMn") ? "failed" : "interrupted"
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: SESSION,
              messageId: input.messageId,
              status,
              createdAt: 1,
              terminalAt: 2,
              failure: { retryable: false },
            },
          },
        })
      },
    })

    try {
      const adapter = loopbackAdapter(server)
      const failed = await adapter.result({ cloudAgentSessionId: SESSION, messageId: "msg_018f1e2d3c4bAbCdEfGhIjKlMn" })
      expect(failed.exitCode).toBe(3)
      const interrupted = await adapter.result({
        cloudAgentSessionId: SESSION,
        messageId: "msg_018f1e2d3c4bZyXwVuTsRqPoNm",
      })
      expect(interrupted.exitCode).toBe(4)
    } finally {
      await server.stop(true)
    }
  })

  test("prefers a provided streamUrl and pins it to the agent origin", async () => {
    const adapter = createCloudAdapter(
      { token: TOKEN, agentOrigin: "https://agent.example", webAppOrigin: "https://app.example" },
      {
        ticketClient: () => {
          throw new Error("ticket fallback must not run when streamUrl is present")
        },
      },
    )
    const prepared = await adapter.prepare({
      cloudAgentSessionId: SESSION,
      streamUrl: "wss://agent.example/stream?ticket=direct",
    })
    expect(prepared).toEqual({ origin: "https://agent.example", streamUrl: "wss://agent.example/stream?ticket=direct" })
  })

  test("rejects a provided streamUrl on another origin without fetching a ticket", async () => {
    let fetched = false
    const adapter = createCloudAdapter(
      { token: TOKEN, agentOrigin: "https://agent.example", webAppOrigin: "https://app.example" },
      {
        ticketClient: () => ({
          async fetchTicket() {
            fetched = true
            return { ticket: "tok", expiresAt: 1 }
          },
        }),
      },
    )
    await expect(
      adapter.prepare({ cloudAgentSessionId: SESSION, streamUrl: "wss://other.example/stream?ticket=x" }),
    ).rejects.toThrow("Invalid stream URL origin")
    expect(fetched).toBe(false)
  })

  test("builds the fallback stream path from a fetched ticket", async () => {
    const tickets: { cloudAgentSessionId: string; organizationId?: string }[] = []
    const adapter = createCloudAdapter(
      { token: TOKEN, organizationId: ORG, agentOrigin: "https://agent.example", webAppOrigin: "https://app.example" },
      {
        ticketClient: () => ({
          async fetchTicket(input: { cloudAgentSessionId: string; organizationId?: string }) {
            tickets.push(input)
            return { ticket: "tok", expiresAt: 1 }
          },
        }),
      },
    )
    const prepared = await adapter.prepare({ cloudAgentSessionId: SESSION })
    expect(prepared).toEqual({
      origin: "https://agent.example",
      streamUrl: `/stream?cloudAgentSessionId=${SESSION}&ticket=tok`,
    })
    expect(tickets).toEqual([{ cloudAgentSessionId: SESSION, organizationId: ORG }])
  })

  test("streams events to the caller-supplied sink over the injected socket", async () => {
    const lines: string[] = []
    class Socket {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      constructor(_url: string) {
        queueMicrotask(() => {
          this.onmessage?.(new MessageEvent("message", { data: '{"event":"one"}' }))
          this.onclose?.({ code: 1000 } as CloseEvent)
        })
      }
      close() {}
    }

    const adapter = createCloudAdapter(
      { token: TOKEN, agentOrigin: "https://agent.example", webAppOrigin: "https://app.example" },
      { WebSocket: Socket as unknown as typeof WebSocket },
    )
    await adapter.streamEvents({
      streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
      writeLine: (line) => {
        lines.push(line)
      },
    })
    expect(lines).toEqual(['{"event":"one"}'])
  })

  test("surfaces stream failures as CloudError", async () => {
    class Socket {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      constructor(_url: string) {
        queueMicrotask(() => this.onerror?.())
      }
      close() {}
    }

    const adapter = createCloudAdapter(
      { token: TOKEN, agentOrigin: "https://agent.example", webAppOrigin: "https://app.example" },
      { WebSocket: Socket as unknown as typeof WebSocket },
    )
    const error: unknown = await adapter
      .streamEvents({ streamUrl: "/stream", writeLine: () => {} })
      .then(
        () => new Error("Expected stream to fail"),
        (cause: unknown) => cause,
      )
    expect(error).toBeInstanceOf(CloudError)
    expect((error as Error).message).toBe("WebSocket stream connection failed")
  })
})
