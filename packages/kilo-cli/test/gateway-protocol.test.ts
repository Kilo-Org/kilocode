import { expect, test } from "bun:test"
import path from "node:path"
import { fixture } from "./fixture"

test("the execution host dispatches catalog-selected Gateway protocols and replays settled history", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      path.resolve(import.meta.dir, "../dist/interactive/bun"),
      "--no-env-file",
      path.join(import.meta.dir, "gateway-protocol-fixture.ts"),
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
    expect(stdout).toContain("GATEWAY_PROTOCOL_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 60000)
