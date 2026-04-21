// packages/opencode/test/devilcode/workflow-tui/team-io.commands.test.ts
// Phase 6 — unit tests for exportCommand/importCommand handlers
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import fsSync from "fs"
import path from "path"
import os from "os"
import {
  exportCommand,
  importCommand,
  type TeamIOCommandHandlers,
} from "@/devilcode/workflow-tui/commands/team-io"
import {
  TeamVersionMismatchError,
  TeamChecksumError,
  TeamSchemaValidationError,
  TeamImportError,
} from "@/devilcode/team"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import { exportTeamToFile } from "@/devilcode/team/io"
import { computeTeamChecksum } from "@/devilcode/team/checksum"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devilcode-team-io-cmd-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeHandlers(team?: CanonicalTeamConfig): TeamIOCommandHandlers {
  return {
    getActiveTeam: mock(() => team),
    onImported: mock(async () => {}),
    prompt: mock(async () => undefined),
    toast: {
      success: mock(() => {}),
      error: mock(() => {}),
      warning: mock(() => {}),
    },
  }
}

function fixtureTeam(): CanonicalTeamConfig {
  return loadQuickstartTemplates()["solo-enhanced"].team
}

describe("exportCommand", () => {
  test("happy path: writes envelope + reports success with checksum prefix", async () => {
    const target = path.join(tmpDir, "export.json")
    const handlers = makeHandlers(fixtureTeam())
    await exportCommand({ path: target }, handlers)
    expect((handlers.toast.success as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    const msg = (handlers.toast.success as ReturnType<typeof mock>).mock.calls[0][0]
    expect(msg).toContain(path.resolve(target))
    expect(msg).toMatch(/\([a-f0-9]{12}\.\.\.\)/)
    // file written
    const text = await fs.readFile(target, "utf-8")
    const parsed = JSON.parse(text)
    expect(parsed.version).toBe("1.1.0") // devilcode_change — Phase 7: version bumped to 1.1.0
  })

  test("empty path: emits warning, does not write", async () => {
    const handlers = makeHandlers(fixtureTeam())
    await exportCommand({ path: "" }, handlers)
    expect((handlers.toast.warning as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.warning as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "Usage: team export <path>",
    )
    expect((handlers.toast.success as ReturnType<typeof mock>).mock.calls.length).toBe(0)
  })

  test("no active team: emits warning, does not write", async () => {
    const target = path.join(tmpDir, "should-not-exist.json")
    const handlers = makeHandlers(undefined)
    await exportCommand({ path: target }, handlers)
    expect((handlers.toast.warning as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.warning as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "No active team to export",
    )
    expect((handlers.toast.success as ReturnType<typeof mock>).mock.calls.length).toBe(0)
    // file must not exist
    expect(fsSync.existsSync(target)).toBe(false)
  })

  test("write error: reports toast.error", async () => {
    // path inside a non-existent directory — writeFile will reject
    const target = path.join(tmpDir, "does-not-exist-dir", "export.json")
    const handlers = makeHandlers(fixtureTeam())
    await exportCommand({ path: target }, handlers)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls[0][0]).toContain(
      "Export failed:",
    )
  })
})

describe("importCommand", () => {
  test("happy path: invokes onImported + toast.success", async () => {
    const target = path.join(tmpDir, "valid.json")
    await exportTeamToFile(target, fixtureTeam(), { exportedBy: "test" })
    const handlers = makeHandlers()
    await importCommand({ path: target }, handlers)
    expect((handlers.onImported as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.success as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.success as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "Team imported",
    )
  })

  test("empty path: emits warning", async () => {
    const handlers = makeHandlers()
    await importCommand({ path: "" }, handlers)
    expect((handlers.toast.warning as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.warning as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "Usage: team import <path>",
    )
  })

  test("TeamVersionMismatchError → 'Version mismatch'", async () => {
    const target = path.join(tmpDir, "version-mismatch.json")
    const team = fixtureTeam()
    const bad = {
      version: "9.9.9",
      checksum: computeTeamChecksum(team),
      config: team,
      exportedAt: new Date().toISOString(),
    }
    fsSync.writeFileSync(target, JSON.stringify(bad, null, 2), "utf-8")
    const handlers = makeHandlers()
    await importCommand({ path: target }, handlers)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls[0][0]).toContain(
      "Version mismatch",
    )
    expect((handlers.onImported as ReturnType<typeof mock>).mock.calls.length).toBe(0)
  })

  test("TeamChecksumError → 'Checksum failed'", async () => {
    const target = path.join(tmpDir, "bad-checksum.json")
    const team = fixtureTeam()
    const bad = {
      version: "1.0.0",
      checksum: "0".repeat(64), // valid-shape but wrong
      config: team,
      exportedAt: new Date().toISOString(),
    }
    fsSync.writeFileSync(target, JSON.stringify(bad, null, 2), "utf-8")
    const handlers = makeHandlers()
    await importCommand({ path: target }, handlers)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls[0][0]).toContain(
      "Checksum failed",
    )
  })

  test("TeamSchemaValidationError → 'Schema invalid'", async () => {
    const target = path.join(tmpDir, "bad-envelope.json")
    // envelope-shape (has version, checksum, config) but config malformed
    const bad = {
      version: "1.0.0",
      checksum: "a".repeat(64),
      config: { enabled: "not-a-bool", roles: "not-an-object" },
      exportedAt: new Date().toISOString(),
    }
    fsSync.writeFileSync(target, JSON.stringify(bad, null, 2), "utf-8")
    const handlers = makeHandlers()
    await importCommand({ path: target }, handlers)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls[0][0]).toContain(
      "Schema invalid",
    )
  })

  test("TeamImportError file-not-found → 'File not found'", async () => {
    const target = path.join(tmpDir, "does-not-exist.json")
    const handlers = makeHandlers()
    await importCommand({ path: target }, handlers)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls[0][0]).toContain(
      "File not found:",
    )
  })

  test("TeamImportError json-parse-failed → 'Invalid JSON'", async () => {
    const target = path.join(tmpDir, "bad.json")
    fsSync.writeFileSync(target, "not { valid json]]", "utf-8")
    const handlers = makeHandlers()
    await importCommand({ path: target }, handlers)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls.length).toBe(1)
    expect((handlers.toast.error as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "Invalid JSON",
    )
  })

  test("error instance propagation coverage — confirms all error types reachable", () => {
    // sanity: imports must be live — ensures tree-shaking doesn't drop error classes
    expect(new TeamVersionMismatchError({ found: "0.0.0", required: "1.0.0" })).toBeInstanceOf(
      TeamImportError,
    )
    expect(new TeamChecksumError()).toBeInstanceOf(TeamImportError)
    expect(
      new TeamSchemaValidationError({ layer: "envelope", issues: [] }),
    ).toBeInstanceOf(TeamImportError)
  })
})
