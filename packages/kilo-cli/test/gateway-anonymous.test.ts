import { expect, test } from "bun:test"
import path from "node:path"
import { fixture } from "./fixture"

for (const scenario of ["available", "empty", "failed", "background"])
  test(`signed-out Kilo catalog (${scenario}) never falls back to Zen or paid seeds`, async () => {
    await using input = await fixture()
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", path.join(import.meta.dir, "gateway-anonymous-fixture.ts")],
      {
        cwd: input.cwd,
        env: { ...input.env, KILO_ANONYMOUS_SCENARIO: scenario },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        timeout: 45000,
      },
    )
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      expect(stdout).toContain("GATEWAY_ANONYMOUS_OK")
    } finally {
      child.kill()
      await child.exited
    }
  }, 60000)
