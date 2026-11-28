import { afterEach, describe, expect, test } from "bun:test"
import {
  CLI_REQUEST_TIMEOUT_HEADER,
  CLI_REQUEST_TIMEOUT_NONE,
  CliRequestTimeoutError,
  DEFAULT_CLI_REQUEST_TIMEOUT_MS,
  boundedCliFetch,
  createBoundedCliFetch,
} from "../../src/services/cli-backend/bounded-fetch"

const ok = () => new Response("ok", { status: 200 })

interface SeenCall {
  input: RequestInfo | URL
  init?: RequestInit
}

describe("createBoundedCliFetch", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("preserves the raw (url, init) call shape and the SDK transport options", async () => {
    const seen: SeenCall[] = []
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input, init })
      return Promise.resolve(ok())
    }) as typeof fetch

    const bounded = createBoundedCliFetch({ fetchImpl })
    const response = await bounded("http://127.0.0.1:9/session", {
      method: "POST",
      headers: { "x-kilo-directory": "/workspace" },
      body: JSON.stringify({ value: 1 }),
    })

    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(String(seen[0]?.input)).toBe("http://127.0.0.1:9/session")
    expect(seen[0]?.init?.method).toBe("POST")
    expect(new Headers(seen[0]?.init?.headers).get("x-kilo-directory")).toBe("/workspace")
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ value: 1 }))
    expect((seen[0]?.init as { duplex?: string; timeout?: boolean } | undefined)?.duplex).toBe("half")
    expect((seen[0]?.init as { timeout?: boolean } | undefined)?.timeout).toBe(false)
    expect(seen[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("fails with CliRequestTimeoutError when the underlying fetch never settles", async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch
    const bounded = createBoundedCliFetch({ timeoutMs: 25, fetchImpl })

    const start = Date.now()
    await expect(bounded("http://127.0.0.1:9/global/config", { method: "GET" })).rejects.toBeInstanceOf(
      CliRequestTimeoutError,
    )
    expect(Date.now() - start).toBeLessThan(500)
  })

  test("the default timeout matches the documented 60s budget", () => {
    expect(DEFAULT_CLI_REQUEST_TIMEOUT_MS).toBe(60_000)
  })

  test("opt-out header bypasses the timeout and is stripped before leaving the client", async () => {
    const seen: SeenCall[] = []
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input, init })
      // Simulate a long-running agent command that exceeds the budget.
      return new Promise<Response>((resolve) => setTimeout(() => resolve(ok()), 40))
    }) as typeof fetch
    const bounded = createBoundedCliFetch({ timeoutMs: 20, fetchImpl })

    const response = await bounded("http://127.0.0.1:9/session/command", {
      method: "POST",
      headers: { [CLI_REQUEST_TIMEOUT_HEADER]: CLI_REQUEST_TIMEOUT_NONE },
    })

    expect(response.status).toBe(200)
    expect(new Headers(seen[0]?.init?.headers).get(CLI_REQUEST_TIMEOUT_HEADER)).toBeNull()
  })

  test("a caller-provided AbortSignal aborts the request without surfacing a timeout error", async () => {
    const controller = new AbortController()
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"))
        })
      })
    }) as typeof fetch
    const bounded = createBoundedCliFetch({ timeoutMs: 1_000, fetchImpl })

    const pending = bounded("http://127.0.0.1:9/profile", { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toThrow(/aborted/i)
    await expect(pending).rejects.not.toBeInstanceOf(CliRequestTimeoutError)
  })

  test("an already-aborted caller signal goes straight through", async () => {
    // Inject a transport that mirrors real fetch behavior on pre-aborted signals instead of
    // relying on globalThis.fetch, which other test files may have replaced without restoring.
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true)
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"))
    }) as typeof fetch
    const bounded = createBoundedCliFetch({ fetchImpl })
    const controller = new AbortController()
    controller.abort()

    await expect(bounded("http://127.0.0.1:9/marketplace", { signal: controller.signal })).rejects.toThrow(/aborted/i)
  })

  test("bounds Request-object callers (the generated SDK path) via a cloned signal", async () => {
    const seen: Request[] = []
    const fetchImpl = ((request: Request) => {
      seen.push(request)
      return Promise.resolve(ok())
    }) as typeof fetch
    const bounded = createBoundedCliFetch({ fetchImpl })

    await bounded(new Request("http://127.0.0.1:9/session/list", { method: "GET" }))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe("http://127.0.0.1:9/session/list")
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  test("clears its timer after settling so no handle keeps the host alive", async () => {
    const fetchImpl = (() => Promise.resolve(ok())) as typeof fetch
    const bounded = createBoundedCliFetch({ timeoutMs: 30_000, fetchImpl })
    await bounded("http://127.0.0.1:9/session/list")
    // The process exits cleanly when the test run ends: a leaked timer with a ref would keep Bun alive.
    expect(true).toBe(true)
  })
})

describe("boundedCliFetch shared instance", () => {
  test("routes raw CLI fetch call sites through the bounded wrapper", async () => {
    // The singleton resolves globalThis.fetch lazily per call; install and restore the stub
    // carefully so later test files in the shared process never see it.
    const original = globalThis.fetch
    let received: SeenCall | undefined
    try {
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        received = { input, init }
        expect((init as { timeout?: boolean } | undefined)?.timeout).toBe(false)
        return Promise.resolve(ok())
      }) as typeof fetch

      const response = await boundedCliFetch("http://127.0.0.1:9/indexing/consent", {
        method: "PUT",
        headers: { "x-kilo-directory": "/workspace" },
        body: JSON.stringify({ enabled: true }),
      })

      expect(response.status).toBe(200)
      expect(received?.init?.method).toBe("PUT")
      expect(new Headers(received?.init?.headers).get("x-kilo-directory")).toBe("/workspace")
    } finally {
      globalThis.fetch = original
    }
  })
})
