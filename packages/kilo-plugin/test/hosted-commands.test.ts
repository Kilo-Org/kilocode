import { expect, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import { createCommandCatalog } from "../src/hosted/commands"

test("command discovery filters another session’s frames and returns only the authorized catalog", async () => {
  const target = { scope: "s", providerID: "kilo-cloud", workspaceID: "ws", sessionID: "root" } as const
  const sent: string[] = []
  using issuer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      expect(new URL(req.url).pathname).toBe("/api/cloud-agent-next/sessions/stream-ticket")
      expect(await req.json()).toEqual({ cloudAgentSessionId: "control" })
      return Response.json({ ticket: "fixture-ticket", expiresAt: Math.floor(Date.now() / 1000) + 60 })
    },
  })
  using worker = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url)
      expect(url.searchParams.get("eventTypes")).toBe("commands.available")
      expect(url.searchParams.get("ticket")).toBe("fixture-ticket")
      expect(req.headers.get("authorization")).toBeNull()
      if (!server.upgrade(req)) return new Response(null, { status: 400 })
    },
    websocket: {
      open(ws) {
        for (const sessionId of ["other", "control"]) {
          ws.send(
            JSON.stringify({
              sessionId,
              streamEventType: "commands.available",
              data: { commands: [{ name: sessionId + "-skill", hints: [] }] },
            }),
          )
          sent.push(sessionId)
        }
      },
      message() {},
    },
  })
  const commands = createCommandCatalog(
    KiloAccount.resolve({ token: "fixture" }, {}),
    { issuer: issuer.url.origin, worker: worker.url.origin },
    async (t) => {
      expect(t).toEqual(target)
      return "control"
    },
  )
  expect((await commands(target, AbortSignal.timeout(5000))).commands.map((c) => c.name)).toEqual(["control-skill"])
  expect(sent).toEqual(["other", "control"])
})
