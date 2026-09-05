import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fixture } from "./fixture"

function createGatewayMock() {
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
          hasPersonalAccount: true,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
}

test("Kilo TUI privacy persists, hides account labels, and gates profile/team reveal", async () => {
  await using input = await fixture()
  const bundledBun = path.resolve(import.meta.dir, "../dist/interactive/bun")
  expect(await Bun.file(bundledBun).exists(), "Build the bundled Bun runtime before the live TUI proof").toBe(true)
  const gateway = createGatewayMock()
  try {
    const child = Bun.spawn(
      [
        bundledBun,
        "--no-env-file",
        "--preload",
        fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
        path.join(import.meta.dir, "privacy-ui-fixture.tsx"),
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
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      expect(stdout, stderr).toContain("TUI_PRIVACY_FIXTURE_OK")
    } finally {
      child.kill()
      await child.exited
    }
  } finally {
    await gateway.stop(true)
  }
}, 60000)
