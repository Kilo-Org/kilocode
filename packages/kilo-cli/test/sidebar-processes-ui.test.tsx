import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { fixture } from "./fixture"

const scenarios = ["lifecycle", "resume", "server", "client"] as const

const label: Record<(typeof scenarios)[number], string> = {
  lifecycle: "the real process sidebar renders session shells from durable truth (lifecycle)",
  resume: "the real process sidebar renders session shells from durable truth (resume)",
  server: "a restarted server never renders the prior shell as still running (server)",
  client: "a client-only reopen keeps a truly live shell rendered (client)",
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
          path.join(import.meta.dir, "sidebar-processes-ui-fixture.tsx"),
        ],
        {
          cwd: input.cwd,
          env: { ...input.env, TUI_PROCESSES_SCENARIO: scenario },
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
        expect(stdout, stderr).toContain(`TUI_PROCESSES_${scenario.toUpperCase()}_OK`)
      } finally {
        child.kill()
        await child.exited
      }
    },
    150_000,
  )
}
