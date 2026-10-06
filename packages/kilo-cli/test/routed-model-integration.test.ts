import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture, interactiveBun } from "./fixture"

const bundledBun = interactiveBun()

test.skipIf(!bundledBun)("launched Kilo gateway records actual Auto response model without changing the request", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      bundledBun!,
      "--no-env-file",
      "--preload",
      fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
      path.join(import.meta.dir, "routed-model-integration-fixture.ts"),
    ],
    {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: 120000,
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
    expect(stdout).toContain("ROUTED_MODEL_INTEGRATION_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 150000)
