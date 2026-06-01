/**
 * Phase 1 POC license server — POST /api/v1/license/verify
 * Usage: bun deploy/enterprise/mock-license.mjs
 */
const port = Number(process.env.LICENSE_PORT ?? 19090)
const validKeys = new Set(
  (process.env.LICENSE_VALID_KEYS ?? "poc-demo-key,enterprise-poc").split(",").map((k) => k.trim()),
)

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === "POST" && url.pathname === "/api/v1/license/verify") {
      const body = await req.json().catch(() => ({}))
      const key = body.key ?? ""
      if (!validKeys.has(key)) {
        return Response.json({ valid: false, message: "invalid_key" }, { status: 403 })
      }
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      return Response.json({
        valid: true,
        token: `mock-${key}`,
        expiresAt,
        readonly: false,
      })
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true })
    }
    return new Response("not found", { status: 404 })
  },
})

console.log(`[license-mock] listening on http://127.0.0.1:${server.port}`)
