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

describe("fetchManifest — URL validation (SSRF protection)", () => {
  // These tests do NOT require mocking fetch — validation fires before the network call

  it("rejects http:// URLs (non-HTTPS)", async () => {
    await expect(fetchManifest("http://example.com/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    try {
      await fetchManifest("http://example.com/manifest.json")
    } catch (err) {
      expect((err as TeamManifestFetchFailed).message).toContain("HTTPS")
    }
  })

  it("rejects localhost", async () => {
    await expect(fetchManifest("https://localhost/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects 127.x.x.x loopback (dotted-quad)", async () => {
    await expect(fetchManifest("https://127.0.0.1/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("https://127.255.255.255/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects 10.x.x.x RFC-1918 private range", async () => {
    await expect(fetchManifest("https://10.0.0.1/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects 192.168.x.x RFC-1918 private range", async () => {
    await expect(fetchManifest("https://192.168.1.100/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects 172.16-31.x.x RFC-1918 private range", async () => {
    await expect(fetchManifest("https://172.16.0.1/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("https://172.31.255.255/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects 169.254.x.x link-local / cloud metadata range", async () => {
    // AWS EC2 IMDS, Azure IMDS, GCP metadata server all live at 169.254.169.254
    await expect(fetchManifest("https://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("https://169.254.0.1/path")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects IPv6 loopback ::1", async () => {
    await expect(fetchManifest("https://[::1]/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects IPv4-mapped IPv6 addresses (::ffff: prefix)", async () => {
    // ::ffff:127.0.0.1 is a bypass vector — the regex approach misses these
    await expect(fetchManifest("https://[::ffff:127.0.0.1]/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("https://[::ffff:10.0.0.1]/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("https://[::ffff:192.168.1.1]/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects ULA IPv6 addresses (fc00::/7)", async () => {
    await expect(fetchManifest("https://[fd00::1]/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("allows valid public HTTPS URLs", async () => {
    // Should pass URL validation and reach fetch (which is mocked to return success)
    mockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const result = await fetchManifest<{ ok: boolean }>("https://registry.example.com/manifest.json")
    expect(result.ok).toBe(true)
  })

  it("rejects decimal integer IP notation (WHATWG normalises to dotted-quad before our check)", async () => {
    // 2130706433 == 127.0.0.1, 167772161 == 10.0.0.1 — Bun/Node WHATWG URL parser normalises these
    await expect(fetchManifest("https://2130706433/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("https://167772161/manifest.json")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
  })

  it("rejects invalid (malformed) URLs", async () => {
    await expect(fetchManifest("not-a-url")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
    await expect(fetchManifest("://broken")).rejects.toBeInstanceOf(TeamManifestFetchFailed)
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
