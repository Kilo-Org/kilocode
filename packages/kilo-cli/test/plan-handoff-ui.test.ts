import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

test("Plan completion opens the implementing Code session in a new TUI tab", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--preload",
      fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
      path.join(import.meta.dir, "plan-handoff-ui-fixture.tsx"),
    ],
    { cwd: input.cwd, env: input.env, stdout: "pipe", stderr: "pipe", timeout: 45000 },
  )
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, `${stdout}\n${stderr}`).toBe(0)
    expect(stdout).toContain("PLAN_HANDOFF_UI_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 60000)
