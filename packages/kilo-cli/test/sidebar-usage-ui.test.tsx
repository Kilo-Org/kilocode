import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

test("Kilo TUI sidebar renders durable root-and-child usage and refreshes its aggregate", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--preload",
      fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
      path.join(import.meta.dir, "sidebar-usage-ui-fixture.tsx"),
    ],
    {
      cwd: input.cwd,
      env: input.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 45_000,
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
    expect(stdout, stderr).toContain("TUI_SIDEBAR_USAGE_FIXTURE_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 60_000)
