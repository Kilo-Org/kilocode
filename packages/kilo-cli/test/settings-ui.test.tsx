import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fixture, interactiveBun } from "./fixture"

const bundledBun = interactiveBun()

for (const scope of ["profile", "project"]) {
  test.skipIf(!bundledBun)(`Kilo TUI /kilo-settings edits ${scope} configuration the host loads, without touching a session`, async () => {
    await using input = await fixture()
    const child = Bun.spawn(
      [
        bundledBun!,
        "--no-env-file",
        "--preload",
        fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
        path.join(import.meta.dir, "settings-ui-fixture.tsx"),
      ],
      {
        cwd: input.cwd,
        env: { ...input.env, TUI_SETTINGS_SCOPE: scope },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60000,
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
      expect(stdout, stderr).toContain("TUI_SETTINGS_FIXTURE_OK")
    } finally {
      child.kill()
      await child.exited
    }
  }, 90000)
}
