import { beforeEach, describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

const server = "https://kilo.example.test"
const context = {
  currentFilePath: "src/index.ts",
  currentFileContent: "export const value = 1\n",
  cursorLine: 0,
  cursorCharacter: 0,
  editableRegionStartLine: 0,
  editableRegionEndLine: 0,
  recentlyViewedSnippets: [],
  editDiffHistory: [],
}

type Call = { url: string; init: RequestInit }

// A fetch stub that records each call and answers with `reply`.
function stub(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init: init ?? {} })
    return reply(url, init ?? {})
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

function sse(...chunks: unknown[]) {
  return new Response([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join(""), {
    headers: { "content-type": "text/event-stream" },
  })
}

function body(call: Call | undefined): unknown {
  if (typeof call?.init.body !== "string") throw new Error("missing request body")
  return JSON.parse(call.init.body)
}

describe("FIM request", () => {
  beforeEach(() => KiloAutocomplete.clearMistralFimEndpointCache())

  test("sends a streaming request with the key and headers, and collects the text, usage and cost", async () => {
    const http = stub(() =>
      sse(
        { choices: [{ delta: { content: "const " } }] },
        { choices: [{ text: "x = 1" }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 4 }, cost: 0.0002 },
      ),
    )
    const result = await KiloAutocomplete.requestFim({
      target: KiloAutocomplete.resolveFimTarget("kilo", "mistralai/codestral-2508", server),
      key: "gateway-token",
      headers: { "X-KILOCODE-FEATURE": "autocomplete" },
      prefix: "let ",
      suffix: "\n",
      fetch: http.fetch,
    })
    expect(result).toEqual({ text: "const x = 1", cost: 0.0002, inputTokens: 12, outputTokens: 4 })
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0]?.url).toBe("https://kilo.example.test/api/gateway/fim/completions")
    const headers = new Headers(http.calls[0]?.init.headers)
    expect(headers.get("authorization")).toBe("Bearer gateway-token")
    expect(headers.get("x-kilocode-feature")).toBe("autocomplete")
    expect(body(http.calls[0])).toEqual({
      model: "mistralai/codestral-2508",
      prompt: "let ",
      suffix: "\n",
      max_tokens: 256,
      temperature: 0.2,
      stream: true,
    })
  })

  test("passes the requested token limit and temperature through", async () => {
    const http = stub(() => sse({ choices: [{ text: "ok" }] }))
    await KiloAutocomplete.requestFim({
      target: KiloAutocomplete.resolveFimTarget("inception", "mercury-edit-2", server),
      key: "inception-key",
      prefix: "a",
      suffix: "b",
      maxTokens: 64,
      temperature: 0,
      fetch: http.fetch,
    })
    expect(http.calls[0]?.url).toBe("https://api.inceptionlabs.ai/v1/fim/completions")
    expect(body(http.calls[0])).toMatchObject({ model: "mercury-edit-2", max_tokens: 64, temperature: 0 })
  })

  test("tries the Codestral endpoint when the Mistral endpoint rejects the key", async () => {
    const http = stub((url) =>
      url === KiloAutocomplete.MISTRAL_FIM_URL ? new Response("bad key", { status: 401 }) : sse({ choices: [{ text: "x" }] }),
    )
    const result = await KiloAutocomplete.requestFim({
      target: KiloAutocomplete.resolveFimTarget("mistral", "codestral-2508", server),
      key: "mistral-key",
      prefix: "",
      suffix: "",
      fetch: http.fetch,
    })
    expect(result.text).toBe("x")
    expect(http.calls.map((call) => call.url)).toEqual([KiloAutocomplete.MISTRAL_FIM_URL, KiloAutocomplete.CODESTRAL_FIM_URL])
  })

  test("passes the upstream status and body through", async () => {
    const http = stub(() => new Response("Payment Required", { status: 402 }))
    const error = await KiloAutocomplete.requestFim({
      target: KiloAutocomplete.resolveFimTarget("kilo", undefined, server),
      key: "k",
      prefix: "",
      suffix: "",
      fetch: http.fetch,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(KiloAutocomplete.AutocompleteRequestError)
    expect(error).toMatchObject({ status: 402, message: "FIM request failed: 402 Payment Required" })
  })

  test("maps a timeout to 504 and a cancellation to 499", async () => {
    const timeout = stub(() => Promise.reject(new DOMException("timed out", "TimeoutError")))
    expect(
      await KiloAutocomplete.requestFim({ target: KiloAutocomplete.resolveFimTarget(), key: "k", prefix: "", suffix: "", fetch: timeout.fetch }).catch(
        (err: unknown) => err,
      ),
    ).toMatchObject({ status: 504, message: "FIM request timed out" })

    const abort = new AbortController()
    const hang = stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    )
    const pending = KiloAutocomplete.requestFim({
      target: KiloAutocomplete.resolveFimTarget(),
      key: "k",
      prefix: "",
      suffix: "",
      signal: abort.signal,
      fetch: hang.fetch,
    }).catch((err: unknown) => err)
    abort.abort()
    expect(await pending).toMatchObject({ status: 499, message: "FIM request canceled" })
  })
})

describe("FIM stream parsing", () => {
  test("ignores keep-alive comments, malformed chunks and the done marker", () => {
    expect(
      KiloAutocomplete.parseFimStream(
        [": keep-alive", "data: {not json", 'data: {"choices":[{"text":"a"}]}', "data: [DONE]", ""].join("\n"),
      ),
    ).toEqual({ text: "a", cost: 0, inputTokens: 0, outputTokens: 0 })
  })

  test("reads a plain JSON body as one chunk", () => {
    expect(
      KiloAutocomplete.parseFimStream(JSON.stringify({ choices: [{ text: "abc" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })),
    ).toEqual({ text: "abc", cost: 0, inputTokens: 3, outputTokens: 1 })
  })
})

describe("Next Edit request", () => {
  test("sends one user message with the Mercury prompt and returns the fenced body and usage", async () => {
    const http = stub(() =>
      Response.json({
        choices: [{ message: { content: "```typescript\nexport const value = 2\n```" } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }),
    )
    const result = await KiloAutocomplete.requestEdit({
      target: KiloAutocomplete.resolveEditTarget("kilo", "inception/mercury-next-edit", server),
      key: "gateway-token",
      headers: { "X-KILOCODE-ORGANIZATIONID": "org-1", "X-KILOCODE-FEATURE": "autocomplete" },
      context,
      fetch: http.fetch,
    })
    expect(result).toEqual({ content: "export const value = 2", usage: { prompt_tokens: 12, completion_tokens: 6 } })
    expect(http.calls[0]?.url).toBe("https://kilo.example.test/api/gateway/edit/completions")
    const headers = new Headers(http.calls[0]?.init.headers)
    expect(headers.get("authorization")).toBe("Bearer gateway-token")
    expect(headers.get("x-kilocode-organizationid")).toBe("org-1")
    expect(headers.get("x-kilocode-feature")).toBe("autocomplete")
    expect(body(http.calls[0])).toEqual({
      model: "inception/mercury-edit-2",
      max_tokens: 512,
      messages: [{ role: "user", content: KiloAutocomplete.buildMercuryEditPrompt(context) }],
    })
  })

  test("preserves direct Inception edits", async () => {
    const http = stub(() => Response.json({ choices: [{ message: { content: "```\nx\n```" } }] }))
    const result = await KiloAutocomplete.requestEdit({
      target: KiloAutocomplete.resolveEditTarget("inception", "mercury-next-edit", server),
      key: "inception-key",
      context,
      maxTokens: 128,
      fetch: http.fetch,
    })
    expect(result).toEqual({ content: "x" })
    expect(http.calls[0]?.url).toBe("https://api.inceptionlabs.ai/v1/edit/completions")
    expect(new Headers(http.calls[0]?.init.headers).get("authorization")).toBe("Bearer inception-key")
    expect(body(http.calls[0])).toMatchObject({ model: "mercury-edit-2", max_tokens: 128 })
  })

  test("passes upstream statuses through when the error body is unreadable", async () => {
    const http = stub(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("broken"))
            },
          }),
          { status: 429 },
        ),
    )
    expect(
      await KiloAutocomplete.requestEdit({
        target: KiloAutocomplete.resolveEditTarget("inception", "mercury-next-edit", server),
        key: "k",
        context,
        fetch: http.fetch,
      }).catch((err: unknown) => err),
    ).toMatchObject({ status: 429, message: "Edit request failed: 429 <unreadable>" })
  })

  test("maps a timeout to 504 and a cancellation to 499", async () => {
    const target = KiloAutocomplete.resolveEditTarget("inception", "mercury-next-edit", server)
    const timeout = stub(() => Promise.reject(new DOMException("timed out", "TimeoutError")))
    expect(await KiloAutocomplete.requestEdit({ target, key: "k", context, fetch: timeout.fetch }).catch((err: unknown) => err)).toMatchObject({
      status: 504,
      message: "Edit request timed out",
    })
    const abort = new AbortController()
    abort.abort()
    const aborted = stub((_url, init) => Promise.reject(init.signal?.reason))
    expect(
      await KiloAutocomplete.requestEdit({ target, key: "k", context, signal: abort.signal, fetch: aborted.fetch }).catch(
        (err: unknown) => err,
      ),
    ).toMatchObject({ status: 499, message: "Edit request canceled" })
  })
})
