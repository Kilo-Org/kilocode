import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HEADER_FEATURE, HEADER_ORGANIZATIONID } from "@kilocode/kilo-gateway"
import * as Log from "@opencode-ai/core/util/log"
import { KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import * as HttpApiServer from "../../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

const env = {
  KILO_AUTH_CONTENT: process.env.KILO_AUTH_CONTENT,
  INCEPTION_API_KEY: process.env.INCEPTION_API_KEY,
}

const edit = {
  provider: "kilo",
  model: "inception/mercury-next-edit",
  currentFilePath: "src/index.ts",
  currentFileContent: "export const value = 1\n",
  cursorLine: 0,
  cursorCharacter: 0,
  editableRegionStartLine: 0,
  editableRegionEndLine: 0,
  recentlyViewedSnippets: [],
  editDiffHistory: [],
}

function app() {
  const handler = HttpRouter.toWebHandler(
    HttpApiServer.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
    { disableLogger: true },
  ).handler

  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        HttpApiServer.context,
      )
    },
  }
}

async function send(body: Record<string, unknown> = edit, signal?: AbortSignal) {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  return app().request(KiloGatewayPaths.edit, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
    body: JSON.stringify(body),
    signal,
  })
}

function stub(run: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetch: typeof globalThis.fetch = Object.assign(run, { preconnect: globalThis.fetch.preconnect })
  return spyOn(globalThis, "fetch").mockImplementation(fetch)
}

function url(input: RequestInfo | URL) {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function completion(input: RequestInfo | URL) {
  return url(input).endsWith("/edit/completions")
}

function authenticate() {
  process.env.KILO_AUTH_CONTENT = JSON.stringify({
    kilo: {
      type: "oauth",
      refresh: "refresh-token",
      access: "gateway-token",
      expires: Date.now() + 60_000,
      accountId: "org-1",
    },
  })
}

function restore() {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(async () => {
  restore()
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi Kilo next edit", () => {
  test("requires Kilo Gateway authentication for the Kilo-backed model", async () => {
    process.env.KILO_AUTH_CONTENT = "{}"
    expect((await send()).status).toBe(401)
  })

  test("rejects non-edit placeholder targets", async () => {
    process.env.KILO_AUTH_CONTENT = "{}"
    expect((await send({ ...edit, model: "mistralai/codestral-2508" })).status).toBe(400)
  })

  test("proxies Kilo-backed edits with gateway auth and autocomplete headers", async () => {
    authenticate()
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const mock = stub(async (input, init) => {
      if (!completion(input)) return Response.json([])
      calls.push({ input, init })
      return Response.json({
        choices: [{ message: { content: "```typescript\nexport const value = 2\n```" } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      })
    })

    try {
      const response = await send()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        content: "export const value = 2",
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      })
      expect(calls).toHaveLength(1)
      const call = calls[0]
      if (!call) throw new Error("missing edit request")
      expect(url(call.input)).toEndWith("/api/edit/completions")
      const headers = new Headers(call.init?.headers)
      expect(headers.get("authorization")).toBe("Bearer gateway-token")
      expect(headers.get(HEADER_ORGANIZATIONID)).toBe("org-1")
      expect(headers.get(HEADER_FEATURE)).toBe("autocomplete")
      if (typeof call.init?.body !== "string") throw new Error("missing edit request body")
      const body: unknown = JSON.parse(call.init.body)
      expect(body).toMatchObject({ model: "inception/mercury-edit-2", messages: [{ role: "user" }] })
    } finally {
      mock.mockRestore()
    }
  })

  test("preserves direct Inception BYOK edits", async () => {
    process.env.KILO_AUTH_CONTENT = "{}"
    process.env.INCEPTION_API_KEY = "inception-token"
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const mock = stub(async (input, init) => {
      if (!completion(input)) return Response.json([])
      calls.push({ input, init })
      return Response.json({ choices: [{ message: { content: "```\nconst value = 2\n```" } }] })
    })

    try {
      const response = await send({ ...edit, provider: "inception", model: "mercury-next-edit" })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ content: "const value = 2", usage: null })
      const call = calls[0]
      if (!call) throw new Error("missing edit request")
      expect(url(call.input)).toBe("https://api.inceptionlabs.ai/v1/edit/completions")
      const headers = new Headers(call.init?.headers)
      expect(headers.get("authorization")).toBe("Bearer inception-token")
      expect(headers.get(HEADER_ORGANIZATIONID)).toBeNull()
      expect(headers.get(HEADER_FEATURE)).toBeNull()
    } finally {
      mock.mockRestore()
    }
  })

  test("passes upstream statuses through when the error body is unreadable", async () => {
    authenticate()
    const mock = stub(async (input) => {
      if (!completion(input)) return Response.json([])
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("broken upstream body"))
          },
        }),
        { status: 502 },
      )
    })

    try {
      const response = await send()
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: "Edit request failed: 502 <unreadable>" })
    } finally {
      mock.mockRestore()
    }
  })

  test("maps upstream timeouts to 504", async () => {
    authenticate()
    const mock = stub(async (input) => {
      if (!completion(input)) return Response.json([])
      throw new DOMException("timed out", "TimeoutError")
    })

    try {
      expect((await send()).status).toBe(504)
    } finally {
      mock.mockRestore()
    }
  })

  test("maps request cancellation to 499", async () => {
    authenticate()
    const controller = new AbortController()
    const mock = stub(async (input) => {
      if (!completion(input)) return Response.json([])
      controller.abort()
      throw new DOMException("canceled", "AbortError")
    })

    try {
      expect((await send(edit, controller.signal)).status).toBe(499)
    } finally {
      mock.mockRestore()
    }
  })
})
