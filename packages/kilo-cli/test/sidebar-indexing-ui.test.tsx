import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

const scenarios = ["disabled", "progress"] as const

const label: Record<(typeof scenarios)[number], string> = {
  disabled: "the real indexing sidebar reports disabled without starting an engine or model",
  progress: "the real indexing sidebar renders live In Progress and Complete engine states",
}

for (const scenario of scenarios) {
  test(
    label[scenario],
    async () => {
      await using input = await fixture()
      const child = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "--preload",
          fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
          path.join(import.meta.dir, "sidebar-indexing-ui-fixture.tsx"),
        ],
        {
          cwd: input.cwd,
          env: { ...input.env, TUI_INDEXING_SCENARIO: scenario },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: scenario === "progress" ? 120_000 : 30_000,
        },
      )
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(code, `${stdout}\n${stderr}`).toBe(0)
        expect(stdout, stderr).toContain(`TUI_INDEXING_${scenario.toUpperCase()}_OK`)
      } finally {
        child.kill()
        await child.exited
      }
    },
    scenario === "progress" ? 150_000 : 60_000,
  )
}
