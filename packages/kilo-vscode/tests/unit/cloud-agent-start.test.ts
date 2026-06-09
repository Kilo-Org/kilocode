import { describe, expect, it } from "bun:test"
import { CloudAgentStartError, startCloudAgent } from "../../src/agent-manager/cloud-agent/start"

const INDETERMINATE =
  "Cloud Agent session creation may already have succeeded. Check Cloud Agents before manually starting another session."

describe("startCloudAgent", () => {
  it("posts the raw unbatched tRPC request and parses the worker result", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const result = await startCloudAgent({
      url: "https://cloud-agent-next.kilosessions.ai",
      token: "secret-token",
      input: {
        message: { prompt: "Fix the tests" },
        agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        options: { createdOnPlatform: "agent-manager" },
      },
      fetch: async (input, init) => {
        calls.push({ input, init })
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: "cloud_1",
              kiloSessionId: "ses_1",
              messageId: "msg_1",
              delivery: "sent",
            },
          },
        })
      },
    })

    expect(result).toEqual({
      cloudAgentSessionId: "cloud_1",
      kiloSessionId: "ses_1",
      messageId: "msg_1",
      delivery: "sent",
    })
    expect(calls).toHaveLength(1)
    expect(String(calls[0]!.input)).toBe("https://cloud-agent-next.kilosessions.ai/trpc/start")
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      },
      redirect: "error",
    })
    expect(Object.keys(calls[0]!.init!.headers as Record<string, string>).sort()).toEqual([
      "Authorization",
      "Content-Type",
    ])
    expect(calls[0]!.init?.credentials).toBeUndefined()
    expect(calls[0]!.init?.body).toBe(
      JSON.stringify({
        message: { prompt: "Fix the tests" },
        agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        options: { createdOnPlatform: "agent-manager" },
      }),
    )
  })

  it("accepts production HTTPS and explicit loopback HTTP origins", async () => {
    const urls = [
      "https://cloud-agent-next.kilosessions.ai",
      "http://localhost:8787/",
      "http://127.0.0.1:8787",
      "http://[::1]:8787",
    ]

    for (const url of urls) {
      await startCloudAgent({ url, token: "secret-token", input: input(), fetch: async () => success() })
    }
  })

  it("rejects unsafe worker URLs before sending the bearer", async () => {
    const urls = [
      "http://cloud-agent-next.kilosessions.ai",
      "ftp://localhost",
      "https://user:secret@cloud-agent-next.kilosessions.ai",
      "https://cloud-agent-next.kilosessions.ai?token=secret",
      "https://cloud-agent-next.kilosessions.ai#secret",
      "https://cloud-agent-next.kilosessions.ai/kilo",
      "not a URL",
    ]

    const calls: string[] = []
    for (const url of urls) {
      await expect(
        startCloudAgent({
          url,
          token: "secret-token",
          input: input(),
          fetch: async () => {
            calls.push(url)
            return success()
          },
        }),
        url,
      ).rejects.toThrow("Cloud Agent worker URL")
    }
    expect(calls).toEqual([])
  })

  it("classifies explicit HTTP 401 separately from rejected responses", async () => {
    const unauthorized = startCloudAgent({
      url: "https://cloud-agent-next.kilosessions.ai",
      token: "secret-token",
      input: input(),
      fetch: async () => Response.json({ error: { message: "token secret-token expired" } }, { status: 401 }),
    })
    await expect(unauthorized).rejects.toMatchObject({
      kind: "unauthorized",
      message: "Cloud Agent authentication failed",
    })

    const rejected = startCloudAgent({
      url: "https://cloud-agent-next.kilosessions.ai",
      token: "secret-token",
      input: input(),
      fetch: async () =>
        Response.json(trpcError("repository https://github.com/Kilo-Org/secret.git denied", "BAD_REQUEST", 400), {
          status: 400,
        }),
    })
    await expect(rejected).rejects.toMatchObject({
      kind: "rejected",
      message: "Check the Cloud Agent session details and try again.",
    })
  })

  it("maps validated client rejection envelopes to sanitized actionable guidance", async () => {
    const cases = [
      ["PAYMENT_REQUIRED", 402, "Add credits or update billing before starting another Cloud Agent session."],
      ["FORBIDDEN", 403, "Check your account and repository access before starting another Cloud Agent session."],
      ["BAD_REQUEST", 400, "Check the Cloud Agent session details and try again."],
      ["UNPROCESSABLE_CONTENT", 422, "Check the Cloud Agent session details and try again."],
      ["NOT_FOUND", 404, "Check the repository and Cloud Agent configuration before trying again."],
      ["TOO_MANY_REQUESTS", 429, "Wait before starting another Cloud Agent session."],
      ["CONFLICT", 409, "Cloud Agent could not start the session. Check the session details and try again."],
    ] as const

    for (const [code, status, message] of cases) {
      const request = startCloudAgent({
        url: "https://cloud-agent-next.kilosessions.ai",
        token: "secret-token",
        input: input(),
        fetch: async () =>
          Response.json(trpcError("raw worker secret-token https://github.com/Kilo-Org/secret.git", code, status), {
            status,
          }),
      })

      await expect(request, code).rejects.toMatchObject({ kind: "rejected", message })
    }
  })

  it("classifies validated timeout and client-closed envelopes as indeterminate", async () => {
    const cases = [
      ["TIMEOUT", 408],
      ["CLIENT_CLOSED_REQUEST", 499],
    ] as const

    for (const [code, status] of cases) {
      const request = startCloudAgent({
        url: "https://cloud-agent-next.kilosessions.ai",
        token: "secret-token",
        input: input(),
        fetch: async () =>
          Response.json(trpcError("raw worker secret-token https://github.com/Kilo-Org/secret.git", code, status), {
            status,
          }),
      })

      await expect(request, code).rejects.toMatchObject({ kind: "indeterminate", message: INDETERMINATE })
    }
  })

  it("classifies malformed, unreadable, and unrecognized 4xx envelopes as indeterminate", async () => {
    const requests = [
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => Response.json({ error: { message: "repository denied" } }, { status: 400 }),
        }),
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => new Response("raw secret-token body", { status: 400 }),
        }),
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => Response.json(trpcError("repository denied", "UNKNOWN_CODE", 400), { status: 400 }),
        }),
    ]

    for (const request of requests) {
      await expect(request()).rejects.toMatchObject({
        kind: "indeterminate",
        message: INDETERMINATE,
      })
    }
  })

  it("classifies unauthorized-shaped non-401 errors as indeterminate", async () => {
    const request = startCloudAgent({
      url: "https://cloud-agent-next.kilosessions.ai",
      token: "secret-token",
      input: input(),
      fetch: async () => Response.json({ error: { message: "Unauthorized" } }, { status: 403 }),
    })

    await expect(request).rejects.toMatchObject({
      kind: "indeterminate",
      message: INDETERMINATE,
    })
  })

  it("classifies timeout, transport, 5xx, and malformed success as indeterminate", async () => {
    const requests = [
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => {
            throw new DOMException("secret-token", "AbortError")
          },
        }),
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => {
            throw new Error("repository https://github.com/Kilo-Org/secret.git unavailable")
          },
        }),
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => new Response("raw secret-token body", { status: 503 }),
        }),
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => Response.json(trpcError("redirect", "BAD_REQUEST", 302), { status: 302 }),
        }),
      () =>
        startCloudAgent({
          url: "https://cloud-agent-next.kilosessions.ai",
          token: "secret-token",
          input: input(),
          fetch: async () => Response.json({ result: { data: { kiloSessionId: "ses_1" } } }),
        }),
    ]

    for (const request of requests) {
      await expect(request()).rejects.toMatchObject({
        kind: "indeterminate",
        message: INDETERMINATE,
      })
    }
  })

  it("uses a 30-second timeout by default and allows an injected timeout", async () => {
    const waits: number[] = []
    const signals: AbortSignal[] = []
    await startCloudAgent({
      url: "https://cloud-agent-next.kilosessions.ai",
      token: "secret-token",
      input: input(),
      timeout: (ms) => {
        waits.push(ms)
        return AbortSignal.timeout(ms)
      },
      fetch: async (_url, init) => {
        signals.push(init!.signal as AbortSignal)
        return success()
      },
    })

    expect(waits).toEqual([30_000])
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  it("exposes only sanitized classified errors", async () => {
    const request = startCloudAgent({
      url: "https://cloud-agent-next.kilosessions.ai",
      token: "secret-token",
      input: input(),
      fetch: async () =>
        Response.json(trpcError("repository https://github.com/Kilo-Org/secret.git denied", "BAD_REQUEST", 400), {
          status: 400,
        }),
    })

    const error = await request.catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CloudAgentStartError)
    expect(error).toMatchObject({ kind: "rejected", message: "Check the Cloud Agent session details and try again." })
    expect(String(error)).not.toContain("secret")
    expect(String(error)).not.toContain("github.com")
  })
})

function trpcError(message: string, code: string, status: number) {
  return { error: { json: { message, code: -32600, data: { code, httpStatus: status } } } }
}

function input() {
  return {
    message: { prompt: "Fix the tests" },
    agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
    repository: { type: "github" as const, repo: "Kilo-Org/kilocode" },
    options: { createdOnPlatform: "agent-manager" as const },
  }
}

function success(): Response {
  return Response.json({
    result: {
      data: {
        cloudAgentSessionId: "cloud_1",
        kiloSessionId: "ses_1",
        messageId: "msg_1",
        delivery: "sent",
      },
    },
  })
}
