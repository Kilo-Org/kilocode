// packages/opencode/test/devilcode/workflow-tui/team-registry.integration.test.ts
// Phase 8 — structural tests confirming TUI integration wiring
import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const srcRoot = path.resolve(import.meta.dir, "../../../src")

describe("TUI registry integration — command-input.tsx branches", () => {
  const src = readFileSync(path.join(srcRoot, "devilcode/workflow-tui/command-input.tsx"), "utf8")

  test("has team publish branch", () => {
    expect(src).toContain('cmd.startsWith("team publish ")')
  })

  test("has team install branch", () => {
    expect(src).toContain('cmd.startsWith("team install ")')
  })

  test("has team trust branch", () => {
    expect(src).toContain('cmd.startsWith("team trust ")')
  })

  test("has team untrust branch", () => {
    expect(src).toContain('cmd.startsWith("team untrust ")')
  })

  test("imports publishCommand from team-registry", () => {
    expect(src).toContain("publishCommand")
    expect(src).toContain("team-registry")
  })

  test("imports installCommand from team-registry", () => {
    expect(src).toContain("installCommand")
  })

  test("imports trustCommand from team-registry", () => {
    expect(src).toContain("trustCommand")
  })

  test("imports untrustCommand from team-registry", () => {
    expect(src).toContain("untrustCommand")
  })
})

describe("TUI registry integration — index.tsx registration", () => {
  const src = readFileSync(path.join(srcRoot, "devilcode/workflow-tui/index.tsx"), "utf8")

  test("imports registerTeamRegistryCommands", () => {
    expect(src).toContain("registerTeamRegistryCommands")
  })

  test("calls registerTeamRegistryCommands with registry.register", () => {
    expect(src).toContain("registerTeamRegistryCommands(registry.register.bind(registry)")
  })

  test("calls onCleanup with registry cleanup result", () => {
    expect(src).toContain("onCleanup(cleanupRegistryCmds)")
  })
})
