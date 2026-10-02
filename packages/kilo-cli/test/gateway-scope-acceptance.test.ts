import { expect, test } from "bun:test"
import path from "node:path"
import { fixture, interactiveBun } from "./fixture"

const bundledBun = interactiveBun()

test.skipIf(!bundledBun)("Gateway Auto catalogs follow real personal/team scope transitions without stale or cross-Location bleed", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      bundledBun!,
      "--no-env-file",
      path.join(import.meta.dir, "gateway-scope-acceptance-fixture.ts"),
    ],
    {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: 45000,
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
    expect(stdout).toContain("GATEWAY_SCOPE_ACCEPTANCE_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 60000)
