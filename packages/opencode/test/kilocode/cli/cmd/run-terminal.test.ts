import { expect, test } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2"
import { KiloRunTerminal } from "@/kilocode/cli/cmd/run-terminal"

test("routes direct interactive terminal requests through the session workspace", async () => {
  const seen: URL[] = []
  const fetch = Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      seen.push(url)
      if (url.pathname === "/session/ses_terminal") {
        return Response.json({
          id: "ses_terminal",
          slug: "terminal",
          projectID: "proj_test",
          workspaceID: "ws_terminal",
          directory: "/tmp",
          title: "Terminal",
          version: "7.4.20",
          time: { created: 1, updated: 1 },
        })
      }
      return Response.json(true)
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const sdk = createKiloClient({
    baseUrl: "http://test",
    fetch,
  })
  const terminal = KiloRunTerminal.create(sdk, () => "ses_terminal")

  await terminal.write({ terminalID: "itx_terminal", data: "Ada\r" })
  await terminal.resize({ terminalID: "itx_terminal", cols: 80, rows: 14 })
  await terminal.close("itx_terminal")

  const requests = seen.filter((url) => url.pathname.startsWith("/interactive-terminal/"))
  expect(requests).toHaveLength(3)
  expect(requests.every((url) => url.searchParams.get("workspace") === "ws_terminal")).toBe(true)
  expect(seen.filter((url) => url.pathname === "/session/ses_terminal")).toHaveLength(1)
})

test("retries workspace lookup after a failed request", async () => {
  const seen: URL[] = []
  let sessions = 0
  const fetch = Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      seen.push(url)
      if (url.pathname === "/session/ses_terminal") {
        sessions += 1
        if (sessions === 1) return new Response("busy", { status: 503 })
        return Response.json({ workspaceID: "ws_terminal" })
      }
      return Response.json(true)
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const sdk = createKiloClient({ baseUrl: "http://test", fetch })
  const terminal = KiloRunTerminal.create(sdk, () => "ses_terminal")

  await terminal.write({ terminalID: "itx_terminal", data: "Ada\r" })
  await terminal.write({ terminalID: "itx_terminal", data: "Grace\r" })

  expect(sessions).toBe(2)
  const inputs = seen.filter((url) => url.pathname === "/interactive-terminal/itx_terminal/input")
  expect(inputs).toHaveLength(2)
  expect(inputs[0]?.searchParams.get("workspace")).toBeNull()
  expect(inputs[1]?.searchParams.get("workspace")).toBe("ws_terminal")
})
