import { describe, expect, test, afterEach } from "bun:test"
import { createServer, type Server } from "http"
import * as KiloOAuthCallback from "../../src/kilocode/mcp-oauth-callback"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const address = probe.address()
  if (!address || typeof address === "string") throw new Error("missing probe address")
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return address.port
}

type Later = { server: Server | undefined; port: number; path: string }

describe("Kilo MCP OAuth callback", () => {
  afterEach(async () => {
    await McpOAuthCallback.stop()
  })

  test("fails fast when the callback port belongs to another process", async () => {
    const blocker = createServer((_req, res) => {
      res.writeHead(200)
      res.end("occupied")
    })

    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject)
      blocker.listen(0, "127.0.0.1", resolve)
    })

    try {
      const address = blocker.address()
      if (!address || typeof address === "string") throw new Error("missing blocker address")

      await expect(
        McpOAuthCallback.ensureRunning(`http://127.0.0.1:${address.port}/mcp/oauth/callback`),
      ).rejects.toThrow("already in use")
      expect(McpOAuthCallback.isRunning()).toBe(false)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  test("takes the callback listener over and the earlier attempt is rejected by name", async () => {
    const port = await freePort()
    const uri = `http://127.0.0.1:${port}/mcp/oauth/callback`

    // The earlier attempt owns the listener and waits for its browser tab.
    await McpOAuthCallback.ensureRunning(uri)
    const earlier = McpOAuthCallback.waitForCallback("state-of-the-earlier-attempt", "kilo").then(
      () => undefined,
      (error: unknown) => error,
    )

    let later: Later = { server: undefined, port: 0, path: "" }
    try {
      // A second process starts its own attempt: the port is taken and the earlier flow named.
      await KiloOAuthCallback.ensureRunning({
        redirectUri: uri,
        parse: parseRedirectUri,
        state: () => later,
        set: (next) => {
          later = next
        },
        create: () => createServer((_req, res) => res.end("later")),
        stop: async () => {},
        info: () => {},
        error: () => {},
      })

      const failure = await earlier
      expect(KiloOAuthCallback.isReplaced(failure)).toBe(true)
      expect(failure instanceof Error ? failure.message : String(failure)).toBe(
        "this request was replaced by another authorization attempt",
      )
      expect(McpOAuthCallback.isRunning()).toBe(false)
      expect(later.server).toBeDefined()
      expect(later.port).toBe(port)
    } finally {
      if (later.server) await new Promise<void>((resolve) => later.server!.close(() => resolve()))
    }
  })

  test("a request without the takeover header cannot release the listener", async () => {
    const port = await freePort()
    const uri = `http://127.0.0.1:${port}/mcp/oauth/callback`

    // The earlier attempt owns the listener and waits for its browser tab.
    await McpOAuthCallback.ensureRunning(uri)
    const settled = McpOAuthCallback.waitForCallback("state-of-the-earlier-attempt", "kilo").then(
      (code) => code,
      (error: unknown) => error,
    )

    // A web page can send this cross-origin "simple request" (no custom header, so the browser
    // sends no preflight): it must not be able to release a listener waiting for a callback.
    const attack = await fetch(KiloOAuthCallback.takeoverUrl("127.0.0.1", port, "/mcp/oauth/callback"))
    expect(attack.headers.get(KiloOAuthCallback.TAKEOVER_HEADER)).toBe(null)
    await attack.body?.cancel()
    expect(McpOAuthCallback.isRunning()).toBe(true)

    // The genuine browser callback still completes the flow the page tried to abort.
    const callback = await fetch(`${uri}?code=the-code&state=state-of-the-earlier-attempt`)
    await callback.body?.cancel()
    expect(callback.status).toBe(200)
    expect(await settled).toBe("the-code")
  })
})
