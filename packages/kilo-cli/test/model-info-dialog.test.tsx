import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

const scenarios = ["valid", "absent", "empty", "unavailable"]

for (const scenario of scenarios) {
  test(`the relocated Kilo model info dialog inspects models without session mutation (${scenario})`, async () => {
    await using input = await fixture()
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
        path.join(import.meta.dir, "model-info-dialog-fixture.tsx"),
      ],
      {
        cwd: input.cwd,
        env: { ...input.env, TUI_MODEL_INFO_SCENARIO: scenario },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000,
      },
    )
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      expect(stdout, stderr).toContain(`TUI_MODEL_INFO_${scenario.toUpperCase()}_OK`)
    } finally {
      child.kill()
      await child.exited
    }
  }, 150_000)
}
