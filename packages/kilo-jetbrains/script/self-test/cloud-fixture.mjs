// Preload only in cloud-history.py's fresh child. Nothing is sent to a cloud origin.
const real = globalThis.fetch
const sessionID = "ses_fixture_cloud"
const tenant = { type: "user", id: "fixture-owner" }
const user = { id: "msg_cloud_user", type: "user", text: "Private fixture prompt", time: { created: 10 } }
const assistant = { id: "msg_cloud_reply", type: "assistant", agent: "code", model: { providerID: "kilo", id: "kilo-auto/free", variant: "default" }, time: { created: 11, completed: 12 } }
const header = { version: 1, revision: 3, position: 10, sessionID }
const entity = (kind, id, value) => ({ kind, id, value, revision: 3 })
globalThis.fetch = Object.assign(async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return real(input, init)
  if (url.origin === "https://api.kilo.ai" && url.pathname === "/api/profile") return Response.json({ user: { name: "Fixture" }, organizations: [], selectedOrganizationId: null, hasPersonalAccount: true })
  if (url.origin === "https://ai-gateway.kilo.ai" && url.pathname.endsWith("/models")) return Response.json({ data: [] })
  if (url.origin !== "https://session-sync.kiloapps.io") return new Response(null, { status: 404 })
  if (url.pathname === "/v1/auth/exchange" && request.headers.get("authorization") === "Bearer fixture-cloud-only") {
    return Response.json({ version: 1, tenant, userID: tenant.id, token: "fixture-read-grant", expiresAt: new Date(Date.now() + 300_000).toISOString() })
  }
  if (request.method !== "GET" || request.headers.get("authorization") !== "Bearer fixture-read-grant") return new Response(null, { status: 403 })
  if (url.pathname === "/v1/sessions") return Response.json({ version: 1, items: [{ sessionID, tenant, createdAt: 10, live: false }], cursor: null })
  if (url.pathname !== `/v1/sessions/${sessionID}/entities`) return new Response(null, { status: 404 })
  if (!url.searchParams.has("cursor")) return Response.json({ ...header, entities: [
    entity("message", user.id, { seq: 1, message: user }),
    entity("message", assistant.id, { seq: 2, message: assistant, parts: { count: 1, through: 10 } }),
    entity("message-part", assistant.id + "/0", { messageID: assistant.id, ordinal: 0, position: 9, part: { type: "text", text: "Private fixture response" } }),
  ], next: "second-page" })
  if (url.searchParams.get("revision") !== "3" || url.searchParams.get("cursor") !== "second-page") return new Response(null, { status: 409 })
  return Response.json({ ...header, entities: [entity("session", sessionID, { id: sessionID, title: "Private cloud fixture", origin: { directory: "/remote-only" }, parentID: "ses_remote_parent", permissions: [{ action: "shell", resource: "*", effect: "allow" }], time: { created: 10, updated: 12 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })], next: null })
}, { preconnect: real.preconnect })
