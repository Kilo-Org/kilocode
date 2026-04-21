import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { exportTeamToFile, importTeamFromFile } from "@/devilcode/team/io"
import { stableStringify } from "@/devilcode/team/checksum"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
// devilcode_change start — Phase 7 fix F7: workflowOverride round-trip test
import type { CanonicalTeamConfig } from "@/devilcode/team/config"
// devilcode_change end

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devilcode-team-rt-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("io round-trip across all quickstart templates", () => {
  const templates = loadQuickstartTemplates()
  const ids = ["solo-enhanced", "code-review-pair", "full-stack-team", "ci-cd-pipeline", "research-team"] as const

  for (const id of ids) {
    test(`${id} — export → import produces identical stableStringify`, async () => {
      const original = templates[id].team
      const tmpFile = path.join(tmpDir, `${id}.json`)
      const envelope = await exportTeamToFile(tmpFile, original)
      // devilcode_change — Phase 7: version bumped to 1.1.0
      expect(envelope.version).toBe("1.1.0")
      expect(envelope.checksum).toMatch(/^[a-f0-9]{64}$/)
      const imported = await importTeamFromFile(tmpFile)
      expect(stableStringify(imported)).toBe(stableStringify(original))
    })
  }
})

// devilcode_change start — Phase 7 fix F7: round-trip with workflowOverride populated
describe("io round-trip with workflowOverride populated", () => {
  test("export → import preserves workflowOverride", async () => {
    const base = loadQuickstartTemplates()["solo-enhanced"].team
    const withOverride: CanonicalTeamConfig = {
      ...base,
      workflowOverride: {
        dag: {
          stages: ["plan", "build", "ship"],
          edges: [
            { from: "plan", to: "build" },
            { from: "build", to: "ship" },
          ],
        },
      },
    }
    const tmpFile = path.join(tmpDir, "with-override.json")
    const envelope = await exportTeamToFile(tmpFile, withOverride)
    expect(envelope.version).toBe("1.1.0")
    const imported = await importTeamFromFile(tmpFile)
    expect(stableStringify(imported)).toBe(stableStringify(withOverride))
    expect(imported.workflowOverride?.dag.stages).toEqual(["plan", "build", "ship"])
  })
})
// devilcode_change end
