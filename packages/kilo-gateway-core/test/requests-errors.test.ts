import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { KiloErrors, KiloHeaders, KiloMachine, KiloProject, KiloRequests, KiloStream } from "../src/index.js"

describe("KiloHeaders.request, KiloProject, and KiloMachine", () => {
  test("builds full per-request Kilo headers including task, parent task, project, machine, mode, tester, and User-Agent", () => {
    const headers = KiloHeaders.request(
      {
        version: "2.0.27",
        organizationID: "org-123",
        sessionID: "ses_1",
        parentSessionID: "ses_0",
        projectID: "kilocode",
        machineID: "mach_1",
        mode: "code",
        testerWarningsDisabledUntil: Date.now() + 60_000,
      },
      {},
    )
    expect(headers).toEqual({
      "HTTP-Referer": "https://kilocode.ai",
      "X-Title": "Kilo Code",
      "X-KILOCODE-EDITORNAME": "Kilo CLI 2.0.27",
      "X-KILOCODE-FEATURE": "cli",
      "X-KILOCODE-ORGANIZATIONID": "org-123",
      "X-KILOCODE-TESTER": "SUPPRESS",
      "User-Agent": "opencode-kilo-provider/2.0.27",
      "X-KILOCODE-TASKID": "ses_1",
      "X-KILOCODE-PARENT-TASKID": "ses_0",
      "X-KILOCODE-PROJECTID": "kilocode",
      "X-KILOCODE-MACHINEID": "mach_1",
      "x-kilocode-mode": "code",
    })
  })

  test("normalizes git URLs and reads project ID from .kilo/config.json before git remote", async () => {
    expect(KiloProject.normalize("https://github.com/Kilo-Org/kilocode.git")).toBe("kilocode")
    expect(KiloProject.normalize("git@github.com:Kilo-Org/kilocode.git")).toBe("kilocode")
    expect(KiloProject.normalize("a".repeat(120))).toHaveLength(100)

    const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-proj-"))
    try {
      await mkdir(path.join(dir, ".kilo"), { recursive: true })
      await writeFile(
        path.join(dir, ".kilo", "config.json"),
        JSON.stringify({ project: { id: "https://github.com/Kilo-Org/custom-repo.git" } }),
      )
      expect(await Effect.runPromise(KiloProject.resolve(dir))).toBe("custom-repo")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reads KILO_MACHINE_ID or persists telemetry-id in dataDir", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-mach-"))
    try {
      expect(await Effect.runPromise(KiloMachine.get(dir, { KILO_MACHINE_ID: "env-machine" }))).toBe("env-machine")
      const first = await Effect.runPromise(KiloMachine.get(dir, {}))
      expect(first).toBeTruthy()
      const second = await Effect.runPromise(KiloMachine.get(dir, {}))
      expect(second).toBe(first)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("KiloRequests", () => {
  test("promotes x-api-key to Bearer, strips credential metadata keys, strips stateless /responses ids, and injects data_collection", async () => {
    const req = new Request("https://api.kilo.ai/api/gateway/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "kilo-secret",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.4",
        server: "https://api.kilo.ai",
        organizationID: "org-1",
        email: "user@example.test",
        kiloCredentials: true,
        kiloEmptyToken: true,
        input: [
          { type: "item_reference", id: "ref_1" },
          { type: "message", id: "msg_1", role: "user", content: "hi" },
        ],
      }),
    })
    const rewritten = await KiloRequests.rewriteRequest(req, { dataCollection: "deny" })
    expect(rewritten.headers.get("authorization")).toBe("Bearer kilo-secret")
    expect(rewritten.headers.get("x-api-key")).toBeNull()
    const body = await rewritten.json()
    expect(body).toEqual({
      model: "openai/gpt-5.4",
      input: [{ type: "message", role: "user", content: "hi" }],
      provider: { data_collection: "deny" },
    })
  })

  test("keeps stored and non-JSON bodies and merges data_collection into existing provider options", () => {
    const input = [
      { type: "item_reference", id: "ref_1" },
      { type: "message", id: "msg_1", role: "user", content: "hi" },
    ]
    const stored = JSON.stringify({ store: true, input })
    expect(KiloRequests.transformBody("/responses?x=1", stored)).toBe(stored)
    expect(KiloRequests.transformBody("/responses", "not json", { dataCollection: "deny" })).toBe("not json")
    expect(JSON.parse(KiloRequests.transformBody("/responses?x=1", JSON.stringify({ input }))!)).toEqual({
      input: [{ type: "message", role: "user", content: "hi" }],
    })
    expect(
      JSON.parse(
        KiloRequests.transformBody(
          "https://ai-gateway.kilo.ai/api/v1/chat/completions",
          JSON.stringify({ messages: [], provider: { order: ["a"] } }),
          { dataCollection: "deny" },
        )!,
      ),
    ).toEqual({ messages: [], provider: { order: ["a"], data_collection: "deny" } })
  })
})

describe("KiloErrors", () => {
  test("formats PAID_MODEL_AUTH_REQUIRED, PROMOTION_MODEL_LIMIT_REACHED, and 402 usage_limit_exceeded with balance and buyCreditsUrl", async () => {
    const authRes = await KiloErrors.rewriteHttpResponse(
      Response.json(
        {
          error: { code: "PAID_MODEL_AUTH_REQUIRED", message: "Auth required" },
          error_type: "paid_model_auth_required",
        },
        { status: 401 },
      ),
    )
    expect(authRes.status).toBe(401)
    expect(await authRes.json()).toMatchObject({
      error: {
        code: "PAID_MODEL_AUTH_REQUIRED",
        message:
          "You need to sign in to use this model. Sign in or create an account to access over 500 models, use credits at cost, or bring your own key.",
      },
    })

    const promoRes = await KiloErrors.rewriteHttpResponse(
      Response.json(
        {
          error: { code: "PROMOTION_MODEL_LIMIT_REACHED", message: "Limit reached" },
          error_type: "promotion_limit_reached",
        },
        { status: 401 },
      ),
    )
    expect(await promoRes.json()).toMatchObject({
      error: {
        code: "PROMOTION_MODEL_LIMIT_REACHED",
        message:
          "You need to sign up to keep going. Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later.",
      },
    })

    const creditsRes = await KiloErrors.rewriteHttpResponse(
      Response.json(
        {
          error: {
            title: "Credits exhausted",
            message: "Your organization balance is depleted.",
            balance: 0,
            buyCreditsUrl: "https://app.kilo.ai/billing",
          },
          error_type: "usage_limit_exceeded",
        },
        { status: 402 },
      ),
    )
    expect(creditsRes.status).toBe(402)
    expect(await creditsRes.json()).toMatchObject({
      error: {
        code: "usage_limit_exceeded",
        message:
          "Credits exhausted: Your organization balance is depleted. (Balance: $0.00) Buy credits at https://app.kilo.ai/billing",
      },
    })
  })

  test("marks Kilo errors that need user action as not retryable, also on HTTP 429", async () => {
    const rewrite = (body: unknown, status: number) => KiloErrors.rewriteHttpResponse(Response.json(body, { status }))
    const promo = await rewrite({ code: "PROMOTION_MODEL_LIMIT_REACHED" }, 429)
    expect(promo.status).toBe(429)
    expect(promo.headers.get("x-should-retry")).toBe("false")
    expect((await rewrite({ error: { message: "Too Many Requests" } }, 429)).headers.has("x-should-retry")).toBe(false)
    // A generic Gateway 408 or 409 keeps the upstream retry decision.
    expect((await rewrite({ error: { message: "Request Timeout" } }, 408)).headers.has("x-should-retry")).toBe(false)
    expect((await rewrite({ error: { message: "Conflict" } }, 409)).headers.has("x-should-retry")).toBe(false)
    expect(
      (await rewrite({ error: "Auto top-up in progress", error_type: "top_up_in_progress" }, 503)).headers.has(
        "x-should-retry",
      ),
    ).toBe(false)
  })

  test("retains structured outer errors instead of replacing them with a JSON message", async () => {
    for (const outer of [
      { error: { code: "PROMOTION_MODEL_LIMIT_REACHED" } },
      { error_type: "PROMOTION_MODEL_LIMIT_REACHED" },
      { code: "PROMOTION_MODEL_LIMIT_REACHED" },
      { type: "response.failed", response: { error: { code: "PROMOTION_MODEL_LIMIT_REACHED" } } },
    ]) {
      const body = { ...outer, message: '{"foo":"bar"}' }
      expect(KiloErrors.parse(body)).toMatchObject({ code: "PROMOTION_MODEL_LIMIT_REACHED", retryable: false })
      const result = await KiloErrors.rewriteHttpResponse(Response.json(body, { status: 429 }))
      expect(result.headers.get("x-should-retry")).toBe("false")
    }
  })

  test("classifies top_up_in_progress as retryable and policy/allow-list errors as non-retryable", () => {
    expect(
      KiloErrors.parse(
        JSON.stringify({
          error: "Auto top-up in progress",
          error_type: "top_up_in_progress",
          message: "Auto top-up is in progress, please retry shortly.",
        }),
        503,
      ),
    ).toMatchObject({
      code: "top_up_in_progress",
      message: "Auto top-up is in progress, please retry shortly.",
      retryable: true,
    })

    for (const [errorType, status, msg] of [
      ["model_not_allowed", 404, "Model is blocked by organization policy"],
      ["provider_not_allowed", 403, "Provider is blocked by organization policy"],
      ["data_collection_required", 400, "No zero-data-retention endpoint available for this model"],
      ["upgrade_required", 426, "Please upgrade your Kilo CLI to continue"],
    ] as const) {
      expect(KiloErrors.parse(JSON.stringify({ error: msg, error_type: errorType }), status)).toMatchObject({
        code: errorType,
        message: msg,
        retryable: false,
      })
    }
  })
})

describe("KiloStream", () => {
  test("extracts routedModelID from gateway routing metadata and stamps usage on SSE streams", async () => {
    let completed: KiloStream.StreamMetadata | undefined
    const sse = [
      `data: ${JSON.stringify({
        type: "message_start",
        provider_metadata: {
          gateway: {
            routing: {
              modelAttempts: [
                { canonicalSlug: "openai/gpt-5.4", success: false },
                { canonicalSlug: "anthropic/claude-sonnet-4.6", success: true },
              ],
            },
          },
        },
        message: { model: "kilo-auto/frontier" },
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n")

    const response = KiloStream.transformResponse(
      new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-vercel-id": "iad1::12345" },
      }),
      (meta) => {
        completed = meta
      },
    )
    const text = await response.text()
    expect(text).toContain('"routedModelID":"anthropic/claude-sonnet-4.6"')
    expect(completed).toEqual({
      routedModelID: "anthropic/claude-sonnet-4.6",
      gateway: {
        routing: {
          modelAttempts: [
            { canonicalSlug: "openai/gpt-5.4", success: false },
            { canonicalSlug: "anthropic/claude-sonnet-4.6", success: true },
          ],
        },
      },
      vercelID: "iad1::12345",
    })
  })

  test("normalizes mid-stream response.failed and bare error SSE frames", () => {
    const failedFrame = KiloStream.transformSseData(
      JSON.stringify({
        type: "response.failed",
        response: {
          error: {
            code: "PAID_MODEL_AUTH_REQUIRED",
            message: "Raw auth error",
          },
        },
      }),
    )
    expect(JSON.parse(failedFrame)).toMatchObject({
      type: "error",
      error: {
        code: "PAID_MODEL_AUTH_REQUIRED",
        message:
          "You need to sign in to use this model. Sign in or create an account to access over 500 models, use credits at cost, or bring your own key.",
      },
    })
  })
})
