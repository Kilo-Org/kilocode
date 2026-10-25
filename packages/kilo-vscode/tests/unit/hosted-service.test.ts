import { describe, expect, test, afterEach } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { HostedService } from "../../src/hosted/service"

interface Call {
  method: string
  path: string
  workspace: string | null
  body?: unknown
}

interface Reply {
  status?: number
  body: unknown
}

function session(id = "ses_hosted") {
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "/cloud-agent/sessions/" + id,
    title: "Hosted work",
    version: "1",
    time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
  }
}

/**
 * A real local backend stand-in. The service must speak the same generated SDK
 * contract the CLI exposes, so a fake HTTP server catches selector mistakes
 * that a stubbed client would hide.
 */
function backend(handler: (call: Call, index: number) => Reply) {
  const calls: Call[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const call: Call = {
        method: request.method,
        path: url.pathname,
        workspace: url.searchParams.get("workspace"),
        body: request.method === "POST" ? await request.json().catch(() => undefined) : undefined,
      }
      calls.push(call)
      const reply = handler(call, calls.length - 1)
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      })
    },
  })
  const client = createKiloClient({ baseUrl: server.url.href })
  const service = new HostedService(() => client)
  return { server, calls, service }
}

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
})

describe("hosted service", () => {
  test("opens durable history without attaching or subscribing", async () => {
    const ctx = backend((call) => {
      if (call.path.endsWith("/message")) {
        return {
          body: {
            items: [{ info: { id: "msg_1", sessionID: "ses_hosted", role: "user", time: { created: 1 } }, parts: [] }],
            cursor: "next",
          },
        }
      }
      if (call.path.startsWith("/kilocode/session-host/session/")) {
        return { body: { id: { providerID: "kilo-cloud", sessionID: "ses_hosted" }, session: session() } }
      }
      return { status: 404, body: {} }
    })
    stop = () => ctx.server.stop()

    const open = await ctx.service.open("kilo-cloud", "ses_hosted")
    expect(open.key).toBe("host:kilo-cloud:ses_hosted")
    expect(open.items).toHaveLength(1)
    expect(open.cursor).toBe("next")
    expect(ctx.calls.some((call) => call.path.endsWith("/attach"))).toBe(false)
    expect(ctx.calls.some((call) => call.path === "/event")).toBe(false)
    expect(ctx.calls.some((call) => call.path === "/session/status")).toBe(false)
  })

  test("prompt routes the native session through the attachment selector", async () => {
    const ctx = backend((call) => {
      if (call.path.endsWith("/attach")) {
        return {
          body: {
            attachmentID: "wrk_att_1",
            session: { providerID: "kilo-cloud", sessionID: "ses_hosted" },
            expiresAt: Date.now() + 60_000,
          },
        }
      }
      if (call.path === "/session/ses_hosted/prompt_async") return { body: true }
      return { status: 404, body: {} }
    })
    stop = () => ctx.server.stop()

    ctx.service.remember("kilo-cloud", "ses_hosted")
    await ctx.service.prompt("host:kilo-cloud:ses_hosted", {
      messageID: "msg_1",
      parts: [{ type: "text", text: "hello" }],
      agent: "build",
      model: { providerID: "p", modelID: "m" },
    })

    const prompt = ctx.calls.find((call) => call.path === "/session/ses_hosted/prompt_async")
    expect(prompt?.workspace).toBe("wrk_att_1")
    expect(prompt?.method).toBe("POST")
  })

  test("one recoverable failure mints a new attachment and retries once", async () => {
    let attaches = 0
    let reads = 0
    const ctx = backend((call) => {
      if (call.path.endsWith("/attach")) {
        attaches += 1
        return {
          body: {
            attachmentID: `wrk_att_old`,
            session: { providerID: "kilo-cloud", sessionID: "ses_hosted" },
            expiresAt: Date.now() + 60_000,
          },
        }
      }
      if (call.path === "/session/ses_hosted/message") {
        reads += 1
        if (reads === 1) {
          return {
            status: 410,
            body: { error: "KILO_SESSION_ATTACHMENT", code: "expired", message: "Session attachment has expired" },
          }
        }
        return { body: [] }
      }
      return { status: 404, body: {} }
    })
    stop = () => ctx.server.stop()

    ctx.service.remember("kilo-cloud", "ses_hosted")
    const result = await ctx.service.messages("host:kilo-cloud:ses_hosted", { limit: 10 })
    expect(result.data).toEqual([])
    expect(attaches).toBe(2)
    expect(reads).toBe(2)
  })

  test("does not retry an unrecoverable failure", async () => {
    let attaches = 0
    const ctx = backend((call) => {
      if (call.path.endsWith("/attach")) {
        attaches += 1
        return {
          body: {
            attachmentID: "wrk_att_1",
            session: { providerID: "kilo-cloud", sessionID: "ses_hosted" },
            expiresAt: Date.now() + 60_000,
          },
        }
      }
      return {
        status: 400,
        body: { error: "KILO_SESSION_ATTACHMENT", code: "invalid_request", message: "unsupported" },
      }
    })
    stop = () => ctx.server.stop()

    ctx.service.remember("kilo-cloud", "ses_hosted")
    await expect(ctx.service.messages("host:kilo-cloud:ses_hosted", { limit: 10 })).rejects.toBeDefined()
    expect(attaches).toBe(1)
  })

  test("start forwards the caller's idempotency fields and keeps the hosted key", async () => {
    const ctx = backend((call) => {
      if (call.path !== "/kilocode/session-host/session") return { status: 404, body: {} }
      return {
        body: {
          session: { providerID: "kilo-cloud", sessionID: "ses_hosted" },
          messageID: "msg_1",
          delivery: "queued",
          replayed: true,
        },
      }
    })
    stop = () => ctx.server.stop()

    const start = await ctx.service.start({
      repository: { type: "github", repo: "owner/repo" },
      prompt: "hello",
      mode: "build",
      model: "p/m",
      operationKey: "11111111-1111-4111-8111-111111111111",
      messageID: "msg_1",
    })
    expect(start).toEqual({
      key: "host:kilo-cloud:ses_hosted",
      providerID: "kilo-cloud",
      sessionID: "ses_hosted",
      replayed: true,
      delivery: "queued",
    })
    const body = ctx.calls[0]?.body as { operationKey?: string; messageID?: string }
    expect(body.operationKey).toBe("11111111-1111-4111-8111-111111111111")
    expect(body.messageID).toBe("msg_1")
  })

  test("keeps colliding native session ids on their own attachment", async () => {
    const ctx = backend((call, index) => {
      if (call.path.endsWith("/attach")) {
        return {
          body: {
            // Per-call ids, so the assertions can prove each key keeps its own.
            attachmentID: `wrk_att_${index + 1}`,
            session: { providerID: "kilo-cloud", sessionID: "ses_same" },
            expiresAt: Date.now() + 60_000,
          },
        }
      }
      return { body: [] }
    })
    stop = () => ctx.server.stop()

    ctx.service.remember("alpha", "ses_same")
    ctx.service.remember("beta", "ses_same")
    await ctx.service.attach("host:alpha:ses_same")
    await ctx.service.attach("host:beta:ses_same")
    const alpha = ctx.service.attachment("host:alpha:ses_same")?.attachmentID
    const beta = ctx.service.attachment("host:beta:ses_same")?.attachmentID
    expect(alpha).toBe("wrk_att_1")
    expect(beta).toBe("wrk_att_2")
    expect(alpha).not.toBe(beta)
    expect(ctx.calls.filter((call) => call.path.endsWith("/attach"))).toHaveLength(2)
  })

  test("detaches an attachment that lost the invalidation race instead of leaking it", async () => {
    const gate = Promise.withResolvers<void>()
    const detached: string[] = []
    const service = new HostedService(
      () =>
        ({
          sessionHost: {
            attach: async () => {
              await gate.promise
              return { data: { attachmentID: "wrk_att_stale", expiresAt: Date.now() + 60_000 } }
            },
            detach: async (input: { attachmentID: string }) => {
              detached.push(input.attachmentID)
              return { data: true }
            },
          },
        }) as never,
    )
    const key = service.remember("kilo-cloud", "ses_hosted")

    const pending = service.attach(key)
    service.invalidate(key)
    gate.resolve()
    await pending.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(detached).toEqual(["wrk_att_stale"])
  })
})
