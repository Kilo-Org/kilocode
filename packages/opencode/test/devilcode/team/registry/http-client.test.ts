import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { fetchManifest } from "@/devilcode/team/registry/http-client"
import { TeamManifestFetchFailed } from "@/devilcode/team/registry/errors"

// Save and restore the global fetch
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(impl: (...args: any[]) => Promise<Response>): void {
  globalThis.fetch = impl as typeof globalThis.fetch
}

describe("fetchManifest — success", () => {
  it("returns parsed JSON from a successful response", async () => {
    const payload = { version: "1.0", manifests: [] }
    mockFetch(
      async (_url, _opts) =>
        new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }),
    )

    const result = await fetchManifest<typeof payload>("https://example.com/index.json")
    expect(result).toEqual(payload)
  })

  it("sends the default User-Agent header", async () => {
    let capturedHeaders: Headers | undefined
    mockFetch(async (_url, opts) => {
      capturedHeaders = opts?.headers as unknown as Headers
      return new Response("{}", { status: 200 })
    })

    await fetchManifest("https://example.com/index.json")
    // Headers are passed as a plain object in our implementation
    expect(capturedHeaders).toBeDefined()
    const headers = capturedHeaders as unknown as Record<string, string>
    expect(headers["User-Agent"]).toBe("kilo-registry-client/1.0")
  })

  it("accepts a custom userAgent option", async () => {
    let capturedHeaders: Record<string, string> | undefined
    mockFetch(async (_url, opts) => {
      capturedHeaders = opts?.headers as unknown as Record<string, string>
      return new Response("{}", { status: 200 })
    })

    await fetchManifest("https://example.com/x.json", { userAgent: "my-client/2.0" })
    expect(capturedHeaders!["User-Agent"]).toBe("my-client/2.0")
  })
})

describe("fetchManifest — HTTP errors", () => {
  it("throws TeamManifestFetchFailed with statusCode=404 on 404 response", async () => {
    mockFetch(async () => new Response("Not Found", { status: 404 }))

    await expect(fetchManifest("https://example.com/missing.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)

    try {
      await fetchManifest("https://example.com/missing.json")
    } catch (err) {
      expect(err).toBeInstanceOf(TeamManifestFetchFailed)
      const e = err as TeamManifestFetchFailed
      expect(e.statusCode).toBe(404)
      expect(e.url).toBe("https://example.com/missing.json")
    }
  })

  it("throws TeamManifestFetchFailed with statusCode=500 on server error", async () => {
    mockFetch(async () => new Response("Internal Server Error", { status: 500 }))

    try {
      await fetchManifest("https://example.com/index.json")
    } catch (err) {
      expect(err).toBeInstanceOf(TeamManifestFetchFailed)
      const e = err as TeamManifestFetchFailed
      expect(e.statusCode).toBe(500)
    }
  })

  it("includes the url in the thrown error", async () => {
    mockFetch(async () => new Response("Gone", { status: 410 }))

    try {
      await fetchManifest("https://example.com/gone.json")
    } catch (err) {
      const e = err as TeamManifestFetchFailed
      expect(e.url).toBe("https://example.com/gone.json")
    }
  })
})

describe("fetchManifest — network error", () => {
  it("throws TeamManifestFetchFailed on network failure", async () => {
    mockFetch(async () => {
      throw new Error("Network connection refused")
    })

    try {
      await fetchManifest("https://unreachable.example.com/index.json")
    } catch (err) {
      expect(err).toBeInstanceOf(TeamManifestFetchFailed)
      const e = err as TeamManifestFetchFailed
      expect(e.url).toBe("https://unreachable.example.com/index.json")
      expect(e.kind).toBe("manifest_fetch_failed")
    }
  })
})

describe("fetchManifest — timeout", () => {
  it("throws TeamManifestFetchFailed with 'timed out' message when AbortError is raised", async () => {
    mockFetch(async (_url, opts) => {
      // Simulate the AbortController triggering
      const signal = opts?.signal as AbortSignal | undefined
      if (signal) {
        // Artificially trigger abort to simulate timeout
        const abortErr = new Error("The operation was aborted")
        abortErr.name = "AbortError"
        throw abortErr
      }
      return new Response("{}", { status: 200 })
    })

    try {
      await fetchManifest("https://slow.example.com/index.json", { timeoutMs: 1 })
    } catch (err) {
      expect(err).toBeInstanceOf(TeamManifestFetchFailed)
      const e = err as TeamManifestFetchFailed
      expect(e.message).toContain("timed out")
      expect(e.url).toBe("https://slow.example.com/index.json")
    }
  })
})
