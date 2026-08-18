import { describe, expect, test } from "bun:test"
import {
  AgentSendRequestSchema,
  AgentStartRequestSchema,
  GetMessageResultInputSchema,
  MessageIdSchema,
} from "../../../src/kilocode/cloud/contracts"
import { parseServiceOrigin } from "../../../src/kilocode/cloud/origin"
import { MAX_CLOUD_AGENT_RESPONSE_BYTES } from "../../../src/kilocode/cloud/response-json"
import { createCloudAgentClient } from "../../../src/kilocode/cloud/trpc"

const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const OTHER_SESSION = "agent_abcdefab-cdef-4abc-8def-abcdefabcdef"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const OTHER_MESSAGE = "msg_018f1e2d3c4bZyXwVuTsRqPoNm"
const SESSION_MESSAGE = "msg_018f1e2d3c4bQrStUvWxYzAbCd"
const TOKEN = "secret-bearer-value"

type Seen = {
  readonly url: string
  readonly auth: string | null
  readonly body: string
}

function success(data: unknown) {
  return Response.json({ result: { data } })
}

describe("Cloud Agent transport", () => {
  test("places bearer auth only in headers and correlates generated message identities", async () => {
    const seen: Seen[] = []
    const ids: string[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        const body = request.method === "POST" ? await request.text() : ""
        seen.push({ url: url.toString(), auth: request.headers.get("authorization"), body })

        if (url.pathname === "/trpc/start") {
          const input = AgentStartRequestSchema.parse(JSON.parse(body) as unknown)
          const id = MessageIdSchema.parse(input.message.id)
          ids.push(id)
          return success({
            cloudAgentSessionId: input.message.prompt === "invalid-session" ? "invalid" : SESSION,
            kiloSessionId: "ses_123",
            messageId: input.message.prompt === "mismatch" ? OTHER_MESSAGE : id,
            delivery: "queued",
          })
        }

        if (url.pathname === "/trpc/send") {
          const input = AgentSendRequestSchema.parse(JSON.parse(body) as unknown)
          const id = MessageIdSchema.parse(input.message.id)
          ids.push(id)
          return success({
            cloudAgentSessionId:
              input.message.prompt === "mismatch-session" ? OTHER_SESSION : input.cloudAgentSessionId,
            status: "started",
            streamUrl: "wss://cloud-agent.example/stream",
            messageId: input.message.prompt === "mismatch-send" ? OTHER_MESSAGE : id,
            delivery: "queued",
          })
        }

        if (url.pathname === "/trpc/getMessageResult") {
          const raw = url.searchParams.get("input")
          const input = GetMessageResultInputSchema.parse(JSON.parse(raw ?? "null") as unknown)
          return success({
            cloudAgentSessionId: input.messageId === SESSION_MESSAGE ? OTHER_SESSION : input.cloudAgentSessionId,
            messageId: input.messageId === OTHER_MESSAGE ? MESSAGE : input.messageId,
            status: "failed",
            createdAt: 1,
            terminalAt: 2,
            completionSource: "delivery_failure",
            failure: {
              stage: "pre_dispatch",
              code: "workspace_setup_failed",
              subtype: "git_clone_timeout",
              attempts: 1,
              message: "Repository clone timed out",
              retryable: true,
            },
          })
        }

        return new Response(null, { status: 404 })
      },
    })

    try {
      const agent = createCloudAgentClient({
        origin: parseServiceOrigin(server.url.origin, { allowHttpLoopback: true }),
        apiKey: TOKEN,
      })
      const start = await agent.start({
        message: { prompt: "Inspect the repository" },
        agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        options: { createdOnPlatform: "kilo-cli" },
      })
      const send = await agent.send({
        cloudAgentSessionId: start.cloudAgentSessionId,
        message: { prompt: "Continue" },
      })
      const result = await agent.getMessageResult({
        cloudAgentSessionId: send.cloudAgentSessionId,
        messageId: send.messageId,
      })

      expect(MessageIdSchema.safeParse(start.messageId).success).toBe(true)
      expect(MessageIdSchema.safeParse(send.messageId).success).toBe(true)
      expect(ids).toEqual([start.messageId, send.messageId])
      expect(result.failure).toEqual({
        stage: "pre_dispatch",
        code: "workspace_setup_failed",
        subtype: "git_clone_timeout",
        attempts: 1,
        message: "Repository clone timed out",
        retryable: true,
      })
      expect(seen).toHaveLength(3)
      expect(seen.every((request) => request.auth === `Bearer ${TOKEN}`)).toBe(true)
      expect(seen.every((request) => !request.url.includes(TOKEN) && !request.body.includes(TOKEN))).toBe(true)

      const error = await agent
        .start({
          message: { prompt: "mismatch" },
          agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          options: { createdOnPlatform: "kilo-cli" },
        })
        .then(
          () => new Error("Expected start correlation to fail"),
          (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
        )
      expect(error.message).toBe("Cloud Agent start outcome is unknown; do not retry automatically")
      expect(error.message).not.toContain(TOKEN)

      const malformed = await agent
        .start({
          message: { prompt: "invalid-session" },
          agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          options: { createdOnPlatform: "kilo-cli" },
        })
        .then(
          () => new Error("Expected invalid session ID to fail"),
          (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
        )
      expect(malformed.message).toBe("Cloud Agent start outcome is unknown; do not retry automatically")

      const sendError = await agent.send({ cloudAgentSessionId: SESSION, message: { prompt: "mismatch-send" } }).then(
        () => new Error("Expected send correlation to fail"),
        (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
      )
      expect(sendError.message).toBe("Cloud Agent send outcome is unknown; do not retry automatically")

      const resultError = await agent.getMessageResult({ cloudAgentSessionId: SESSION, messageId: OTHER_MESSAGE }).then(
        () => new Error("Expected result correlation to fail"),
        (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
      )
      expect(resultError.message).toBe("Cloud Agent returned an invalid response")

      const sendSessionError = await agent
        .send({ cloudAgentSessionId: SESSION, message: { prompt: "mismatch-session" } })
        .then(
          () => new Error("Expected send session correlation to fail"),
          (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
        )
      expect(sendSessionError.message).toBe("Cloud Agent send outcome is unknown; do not retry automatically")

      const resultSessionError = await agent
        .getMessageResult({ cloudAgentSessionId: SESSION, messageId: SESSION_MESSAGE })
        .then(
          () => new Error("Expected result session correlation to fail"),
          (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
        )
      expect(resultSessionError.message).toBe("Cloud Agent returned an invalid response")
    } finally {
      await server.stop(true)
    }
  })

  test("rejects malformed send responses before they cross the client boundary", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return success({
          cloudAgentSessionId: "invalid",
          status: "started",
          streamUrl: "",
          messageId: MESSAGE,
          delivery: "queued",
        })
      },
    })

    try {
      const agent = createCloudAgentClient({
        origin: parseServiceOrigin(server.url.origin, { allowHttpLoopback: true }),
        apiKey: TOKEN,
        id: () => MESSAGE,
      })
      const error = await agent.send({ cloudAgentSessionId: SESSION, message: { prompt: "Continue" } }).then(
        () => new Error("Expected send to fail"),
        (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
      )
      expect(error.message).toBe("Cloud Agent send outcome is unknown; do not retry automatically")
    } finally {
      await server.stop(true)
    }
  })

  test("treats redirects, oversized bodies, and malformed envelopes as unknown start outcomes", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const input = AgentStartRequestSchema.parse((await request.json()) as unknown)
        if (input.message.prompt === "redirect") {
          return new Response(null, { status: 302, headers: { location: "/elsewhere" } })
        }
        if (input.message.prompt === "oversized") {
          return new Response(null, {
            headers: { "content-length": String(MAX_CLOUD_AGENT_RESPONSE_BYTES + 1) },
          })
        }
        if (input.message.prompt === "unavailable") return new Response(null, { status: 503 })
        return Response.json({ invalid: true })
      },
    })

    try {
      const agent = createCloudAgentClient({
        origin: parseServiceOrigin(server.url.origin, { allowHttpLoopback: true }),
        apiKey: TOKEN,
      })
      const start = (prompt: string) =>
        agent.start({
          message: { prompt },
          agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          options: { createdOnPlatform: "kilo-cli" },
        })

      for (const prompt of ["redirect", "oversized", "malformed", "unavailable"]) {
        const error = await start(prompt).then(
          () => new Error("Expected start to fail"),
          (cause: unknown) => (cause instanceof Error ? cause : new Error("Non-error rejection")),
        )
        expect(error.message).toBe("Cloud Agent start outcome is unknown; do not retry automatically")
      }
    } finally {
      await server.stop(true)
    }
  })
})
