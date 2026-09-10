import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

const scenarios = ["found", "stale", "nopr", "nogh", "sha", "sha-wrong", "parent", "parent-sha"]

for (const scenario of scenarios) {
  test(`the real PR sidebar renders the pinned v1 protocol (${scenario})`, async () => {
    await using input = await fixture()
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
        path.join(import.meta.dir, "sidebar-pr-ui-fixture.tsx"),
      ],
      {
        cwd: input.cwd,
        env: { ...input.env, TUI_PR_SCENARIO: scenario },
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
      expect(stdout, stderr).toContain(`TUI_PR_${scenario.toUpperCase()}_OK`)
    } finally {
      child.kill()
      await child.exited
    }
  }, 150_000)
}
