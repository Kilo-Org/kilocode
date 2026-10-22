import { describe, expect, it } from "bun:test"
import { createV2Client } from "../../src/services/cli-backend/v2/client"

const request = {
  id: "per_1",
  sessionID: "ses_1",
  action: "shell",
  resources: ["rm out.txt"],
  save: ["rm *"],
  time: { created: 0 },
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })

/** A v2 server stand-in for the permission routes. Records each request so tests can read the sent decision. */
function server() {
  const sent: Array<{ method: string; path: string; body: unknown }> = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const body = req.method === "GET" ? undefined : await req.json().catch(() => undefined)
    sent.push({ method: req.method, path: url.pathname, body })
    if (url.pathname === "/api/permission/request")
      return json({ location: { directory: "/repo" }, data: [request] })
    if (url.pathname === "/api/form") return json({ location: { directory: "/repo" }, data: [] })
    if (url.pathname === "/api/session/ses_1/permission/per_1") return json({ data: request })
    if (url.pathname === "/api/session/ses_1/permission/per_1/reply") return new Response(null, { status: 204 })
    return new Response("not found", { status: 404 })
  }
  const client = createV2Client({
    baseUrl: "http://127.0.0.1:1",
    headers: {},
    fetch: fetch as typeof globalThis.fetch,
    directory: () => "/repo",
  })
  const decision = () => sent.find((item) => item.path.endsWith("/reply"))?.body
  return { client, sent, decision }
}

describe("v2 permission replies", () => {
  it("routes a v1 reply under the session of the request", async () => {
    const api = server()
    const result = await api.client.permission.reply({ requestID: "per_1", reply: "once" })
    expect(result.error).toBeUndefined()
    expect(api.decision()).toMatchObject({ decision: "once" })
  })

  it("sends always when the saved v1 rules cover every pattern of the request", async () => {
    const api = server()
    await api.client.permission.saveAlwaysRules({ requestID: "per_1", approvedAlways: ["rm *"] })
    await api.client.permission.reply({ requestID: "per_1", reply: "once" })
    expect(api.decision()).toMatchObject({ decision: "always" })
  })

  it("fails clearly for a partial pattern selection and sends no reply", async () => {
    const api = server()
    await api.client.permission.saveAlwaysRules({ requestID: "per_1", approvedAlways: ["other *"] })
    const result = await api.client.permission.reply({ requestID: "per_1", reply: "once" })
    expect(String(result.error)).toContain("Saving only some patterns")
    expect(api.decision()).toBeUndefined()
  })

  it("fails clearly for an always-deny rule", async () => {
    const api = server()
    const result = await api.client.permission.saveAlwaysRules({ requestID: "per_1", deniedAlways: ["rm *"] })
    expect(String(result.error)).toContain("not available with the Kilo v2 server")
  })
})

describe("unmapped SDK methods", () => {
  it("return an error instead of fake data", async () => {
    const api = server()
    const result = await api.client.session.revert({ sessionID: "ses_1", messageID: "msg_1" })
    expect(result.data).toBeUndefined()
    expect(String(result.error)).toContain("session.revert is not available with the Kilo v2 server")
    expect(api.sent).toHaveLength(0)
  })
})
