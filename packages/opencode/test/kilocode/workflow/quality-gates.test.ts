// packages/opencode/test/kilocode/workflow/quality-gates.test.ts
import { describe, test, expect } from "bun:test"
import {
  type QualityGate,
  type GateResult,
  detectGates,
  summarizeGateFailures,
} from "@/devilcode/workflow/quality-gates"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("detectGates", () => {
  test("detects npm test in package.json", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-test-"))
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" } }),
    )
    const gates = await detectGates(tmpDir)
    expect(gates.some((g) => g.name === "Test Suite")).toBe(true)
    expect(gates.some((g) => g.name === "Lint")).toBe(true)
    expect(gates.some((g) => g.name === "TypeCheck")).toBe(true)
  })

  test("detects tsconfig.json fallback typecheck", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-test-"))
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: {} }))
    await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{}")
    const gates = await detectGates(tmpDir)
    expect(gates.some((g) => g.name === "TypeCheck")).toBe(true)
  })

  test("returns empty for bare directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-test-"))
    const gates = await detectGates(tmpDir)
    expect(gates).toHaveLength(0)
  })
})

describe("summarizeGateFailures", () => {
  test("summarizes failed gates", () => {
    const results: GateResult[] = [
      { gateName: "Test Suite", passed: true, exitCode: 0, stdout: "ok", stderr: "", durationMs: 100 },
      { gateName: "Lint", passed: false, exitCode: 1, stdout: "", stderr: "2 errors found", durationMs: 200 },
    ]
    const summary = summarizeGateFailures(results)
    expect(summary).toContain("FAILED: Lint")
    expect(summary).toContain("2 errors found")
    expect(summary).not.toContain("Test Suite")
  })

  test("returns empty for all passed", () => {
    const results: GateResult[] = [
      { gateName: "Test Suite", passed: true, exitCode: 0, stdout: "ok", stderr: "", durationMs: 100 },
    ]
    const summary = summarizeGateFailures(results)
    expect(summary).toBe("")
  })
})
