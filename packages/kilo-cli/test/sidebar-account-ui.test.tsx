import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

test("Kilo TUI account sidebar shows genuine zero credits and hides Pass details in privacy mode", async () => {
  await using input = await fixture()
  const bundledBun = path.resolve(import.meta.dir, "../dist/interactive/bun")
  expect(await Bun.file(bundledBun).exists(), "Build the bundled Bun runtime before the live TUI proof").toBe(true)
  const child = Bun.spawn(
    [
      bundledBun,
      "--no-env-file",
      "--preload",
      fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
      path.join(import.meta.dir, "sidebar-account-ui-fixture.tsx"),
    ],
    {
      cwd: input.cwd,
      env: input.env,
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
    expect(stdout, stderr).toContain("TUI_SIDEBAR_ACCOUNT_FIXTURE_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 60000)
