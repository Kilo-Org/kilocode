import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { validateEvidence } from "../src/evidence"
import { root, sandbox } from "./helpers"

describe("demo command", () => {
  test("runs the fake provider and driver end to end and emits schema-valid evidence", async () => {
    await sandbox(async (dir) => {
      const proc = Bun.spawn(
        [
          process.execPath,
          join(root, "src/cli.ts"),
          "demo",
          "--scenario",
          "prompt.stream",
          "--lane",
          "cloud",
          "--artifacts",
          dir,
          "--run-id",
          "cli",
        ],
        {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          env: process.env,
          windowsHide: true,
        },
      )
      const code = await proc.exited
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      expect(stderr).toBe("")
      expect(code).toBe(0)

      const output = JSON.parse(stdout) as {
        artifactsDir: string
        cells: { runId: string; scenarioId: string; lane: string; outcome: string; evidence: string }[]
      }
      expect(output.artifactsDir).toBe(dir)
      expect(output.cells).toHaveLength(1)
      const cell = output.cells[0]
      expect(cell.outcome).toBe("passed")

      const raw = JSON.parse(await Bun.file(cell.evidence).text())
      const evidence = validateEvidence(raw, join(dir, cell.runId))
      expect(evidence.scenarioId).toBe("prompt.stream")
      expect(evidence.lane).toBe("cloud")
      expect(evidence.outcome).toBe("passed")
      expect(evidence.cleanup.status).toBe("clean")
    })
  })
})
