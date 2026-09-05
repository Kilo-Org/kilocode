import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fixture } from "./fixture"

const shareToken = "fixture.payload.signature"

function createGatewayMock() {
  const requests: { path: string; method: string; authorization: string | null }[] = []
  const publication: { data?: unknown; enabled: boolean } = { enabled: false }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({
        path: url.pathname + url.search,
        method: request.method,
        authorization: request.headers.get("authorization"),
      })
      if (url.pathname === "/api/device-auth/codes" && request.method === "POST") {
        return Response.json({ code: "fixture-code", verificationUrl: `${url.origin}/verify`, expiresIn: 60 })
      }
      if (url.pathname === "/api/device-auth/codes/fixture-code") {
        return Response.json({ status: "approved", token: "fixture-token", userEmail: "fixture@example.test" })
      }
      if (url.pathname === "/api/profile") {
        return Response.json({
          user: { email: "fixture@example.test", name: "Fixture" },
          organizations: [],
          selectedOrganizationId: null,
          hasPersonalAccount: true,
        })
      }
      if (url.pathname === "/api/session" && request.method === "POST") {
        const body: { sessionId?: string } = await request.json()
        return Response.json({ id: body.sessionId, ingestPath: `/ingest/${body.sessionId}` })
      }
      if (url.pathname.startsWith("/ingest/") && request.method === "POST") {
        const body: {
          data?: Array<{ type?: string; data?: unknown }>
        } = await request.json()
        publication.data = {
          info: body.data?.find((item) => item.type === "session")?.data,
          messages: body.data
            ?.filter((item) => item.type === "message")
            .map((item) => ({ info: item.data, parts: [] })),
        }
        return new Response(null, { status: 204 })
      }
      if (/^\/api\/session\/[^/]+\/share$/.test(url.pathname) && request.method === "POST") {
        publication.enabled = true
        return Response.json({ success: true, share_token: shareToken })
      }
      if (/^\/api\/session\/[^/]+\/unshare$/.test(url.pathname) && request.method === "POST") {
        publication.enabled = false
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/session/${shareToken}`) {
        return publication.enabled
          ? Response.json(publication.data)
          : Response.json({ success: false, error: "session_not_found" }, { status: 404 })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, requests }
}

for (const mode of ["cancel", "fork", "revoke"] as const) {
  test(
    {
      cancel: "Kilo TUI asks before sharing and does not upload a cancelled session",
      fork: "Kilo TUI shares a transcript and navigates to its imported fork",
      revoke: "Kilo TUI unshares a session and rejects its revoked public link",
    }[mode],
    async () => {
      await using input = await fixture()
      const gateway = createGatewayMock()
      try {
        const child = Bun.spawn(
          [
            process.execPath,
            "--no-env-file",
            "--preload",
            fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
            path.join(import.meta.dir, "sharing-fixture.tsx"),
            mode,
          ],
          {
            cwd: input.cwd,
            env: {
              ...input.env,
              KILO_FIXTURE_GATEWAY: `http://127.0.0.1:${gateway.server.port}`,
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            timeout: 30000,
            killSignal: "SIGKILL",
          },
        )
        try {
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ])
          expect(code, `${mode}\n${stdout}\n${stderr}`).toBe(0)
          expect(stdout, stderr).toContain(`TUI_SHARING_FIXTURE_OK:${mode}`)
          const paths = gateway.requests.map((request) => request.path)
          expect(paths).toContain("/api/profile")
          if (mode === "cancel") {
            expect(paths.some((value) => value.startsWith("/api/session"))).toBe(false)
            expect(paths.some((value) => value.startsWith("/ingest/"))).toBe(false)
          } else {
            expect(paths.some((value) => value.startsWith("/api/session/"))).toBe(true)
            expect(paths.some((value) => value.startsWith("/ingest/"))).toBe(true)
            expect(paths.some((value) => value.endsWith("/share"))).toBe(true)
            expect(paths.some((value) => value.endsWith("/unshare"))).toBe(mode === "revoke")
            expect(paths).toContain(`/session/${shareToken}`)
          }
        } finally {
          child.kill()
          await child.exited
        }
      } finally {
        await gateway.server.stop(true)
      }
    },
    60000,
  )
}
