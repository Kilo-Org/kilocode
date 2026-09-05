import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fixture } from "./fixture"

test("native Kilo model picker groups Auto/recommended and retains favorite actions", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      path.resolve(import.meta.dir, "../dist/interactive/bun"),
      "--no-env-file",
      "--preload",
      fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
      path.join(import.meta.dir, "model-picker-ui-fixture.tsx"),
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
    expect(stdout).toContain("MODEL_PICKER_UI_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 60000)
