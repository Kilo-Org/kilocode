import { describe, expect, test } from "bun:test"
import { createStreamTicketClient, type StreamTicketClient } from "@/kilocode/cloud/stream-ticket"
import { parseServiceOrigin } from "@/kilocode/cloud/origin"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function client(options: { fetch: ReturnType<typeof mockFetch> }): StreamTicketClient {
  return createStreamTicketClient({
    origin: parseServiceOrigin("https://app.example"),
    apiKey: "key",
    fetch: options.fetch.fetch,
  })
}

describe("createStreamTicketClient", () => {
  test("fetches a stream ticket from the web app", async () => {
    const fetch = mockFetch().resolved(jsonResponse({ ticket: "tok", expiresAt: 1234567890 }))
    const result = await client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })

    expect(result).toEqual({ ticket: "tok", expiresAt: 1234567890 })
    expect(fetch.calls).toHaveLength(1)
    const [url, init] = fetch.calls[0]!
    expect(url.toString()).toBe("https://app.example/api/cloud-agent-next/sessions/stream-ticket")
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: expect.objectContaining({
        authorization: "Bearer key",
        "content-type": "application/json",
      }),
      body: JSON.stringify({ cloudAgentSessionId: "agent_123" }),
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("includes organizationId when provided", async () => {
    const fetch = mockFetch().resolved(jsonResponse({ ticket: "tok", expiresAt: 1234567890 }))
    await client({ fetch }).fetchTicket({
      cloudAgentSessionId: "agent_123",
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
    })

    expect(fetch.calls[0]![1]).toMatchObject({
      body: JSON.stringify({
        cloudAgentSessionId: "agent_123",
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
      }),
    })
  })

  test("throws on transport failure", async () => {
    const fetch = mockFetch().rejected(new Error("network error"))
    await expect(client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })).rejects.toThrow(
      "Unable to reach Web App stream ticket endpoint",
    )
  })

  test("retries on 403/404 and succeeds once the session becomes visible", async () => {
    const fetch = mockFetch()
      .resolved(jsonResponse({ error: "Organization does not own this session" }, 403))
      .resolved(jsonResponse({ error: "Organization does not own this session" }, 403))
      .resolved(jsonResponse({ ticket: "tok", expiresAt: 1234567890 }))
    const result = await client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })

    expect(result).toEqual({ ticket: "tok", expiresAt: 1234567890 })
    expect(fetch.calls).toHaveLength(3)
  })

  test("retries when a 404 response has an invalid body", async () => {
    const fetch = mockFetch()
      .resolved(new Response("not json", { status: 404 }))
      .resolved(jsonResponse({ ticket: "tok", expiresAt: 1234567890 }))

    const result = await client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })

    expect(result).toEqual({ ticket: "tok", expiresAt: 1234567890 })
    expect(fetch.calls).toHaveLength(2)
  })

  test("gives up after repeated 403 responses", async () => {
    const fetch = mockFetch().repeated(() => jsonResponse({ error: "Denied" }, 403))
    await expect(client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })).rejects.toThrow("Denied")
    expect(fetch.calls).toHaveLength(10)
  }, 15_000)

  test("throws on authentication failure", async () => {
    const fetch = mockFetch().resolved(jsonResponse({ error: "Unauthorized" }, 401))
    await expect(client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })).rejects.toThrow("Unauthorized")
  })

  test("throws on invalid response", async () => {
    const fetch = mockFetch().resolved(jsonResponse({ missing: "fields" }))
    await expect(client({ fetch }).fetchTicket({ cloudAgentSessionId: "agent_123" })).rejects.toThrow(
      "Web App returned an invalid stream ticket response",
    )
  })
})

function mockFetch() {
  const calls: [URL | RequestInfo, RequestInit | undefined][] = []
  const sequence: (() => Response | Promise<Response>)[] = []
  let fallback: (() => Response | Promise<Response>) | undefined

  const self = {
    calls,
    resolved(value: Response) {
      sequence.push(() => value)
      return self
    },
    repeated(factory: () => Response) {
      fallback = factory
      return self
    },
    rejected(error: unknown) {
      sequence.push(() => Promise.reject(error))
      return self
    },
    get fetch(): typeof fetch {
      return ((input: URL | RequestInfo, init?: RequestInit) => {
        calls.push([input, init])
        const next = sequence.shift() ?? fallback
        if (!next) throw new Error("unexpected fetch call")
        return Promise.resolve(next())
      }) as typeof fetch
    },
  }

  return self
}
