import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fixture } from "./fixture"

function createGatewayMock(options: { hasPersonalAccount?: boolean } = {}) {
  const hasPersonal = options.hasPersonalAccount ?? true
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/device-auth/codes" && request.method === "POST") {
        return Response.json({ code: "fixture-code", verificationUrl: `${url.origin}/verify`, expiresIn: 60 })
      }
      if (url.pathname === "/api/device-auth/codes/fixture-code") {
        return Response.json({ status: "approved", token: "fixture-token", userEmail: "fixture@example.test" })
      }
      if (url.pathname === "/api/profile") {
        expect(request.headers.get("authorization")).toBe("Bearer fixture-token")
        return Response.json({
          user: { email: "fixture@example.test", name: "Fixture" },
          organizations: [
            { id: "org-fixture", name: "Fixture team", role: "member" },
            { id: "org-other", name: "Other team", role: "admin" },
          ],
          selectedOrganizationId: "org-fixture",
          hasPersonalAccount: hasPersonal,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
}

for (const mode of ["standard", "no-personal", "connect"] as const) {
  test(
    mode === "connect"
      ? "Kilo TUI shows a yellow logo and recommends Kilo Gateway first in Connect"
      : mode === "standard"
        ? "Kilo TUI /teams handles login, switches accounts, updates footer, and respects cancel"
        : "Kilo TUI /teams omits Personal account option when hasPersonalAccount is false",
    async () => {
      await using input = await fixture()
      const gateway = createGatewayMock({ hasPersonalAccount: mode !== "no-personal" })
      try {
        const child = Bun.spawn(
          [
            process.execPath,
            "--no-env-file",
            "--preload",
            fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
            path.join(import.meta.dir, "teams-fixture.tsx"),
            mode,
          ],
          {
            cwd: input.cwd,
            env: {
              ...input.env,
              KILO_FIXTURE_GATEWAY: `http://127.0.0.1:${gateway.port}`,
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
          expect(stdout, stderr).toContain(`TUI_TEAMS_FIXTURE_OK:${mode}`)
        } finally {
          child.kill()
          await child.exited
        }
      } finally {
        await gateway.stop(true)
      }
    },
    60000,
  )
}
