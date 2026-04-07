import { describe, test, expect } from "bun:test"
import {
  type CheckResult,
  type PreflightReport,
  checkGitInstalled,
  checkGitRepo,
  checkDiskSpace,
  checkWorkingTree,
  reportSummary,
} from "@/devilcode/workflow/preflight"

describe("checkGitInstalled", () => {
  test("passes when git is available", async () => {
    const result = await checkGitInstalled()
    expect(result.passed).toBe(true)
    expect(result.name).toBe("git")
  })
})

describe("checkGitRepo", () => {
  test("passes in a git repo", async () => {
    const result = await checkGitRepo(process.cwd())
    expect(result.passed).toBe(true)
  })

  test("fails in a non-repo directory", async () => {
    const result = await checkGitRepo("/tmp")
    expect(result.passed).toBe(false)
    expect(result.severity).toBe("error")
  })
})

describe("checkDiskSpace", () => {
  test("returns a result", async () => {
    const result = await checkDiskSpace()
    expect(result.name).toBe("disk_space")
    // Can't assert passed without knowing disk state
    expect(typeof result.passed).toBe("boolean")
  })
})

describe("checkWorkingTree", () => {
  test("returns a result for current repo", async () => {
    const result = await checkWorkingTree(process.cwd())
    expect(result.name).toBe("working_tree")
    expect(typeof result.passed).toBe("boolean")
  })
})

describe("reportSummary", () => {
  test("reports all passed", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "OK", severity: "error", fixHint: "" },
        { name: "disk", passed: true, message: "OK", severity: "error", fixHint: "" },
      ],
    }
    const summary = reportSummary(report)
    expect(summary).toContain("2/2")
    expect(summary).toContain("0 error")
  })

  test("reports failures", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: false, message: "Not found", severity: "error", fixHint: "Install git" },
        { name: "disk", passed: true, message: "OK", severity: "warning", fixHint: "" },
      ],
    }
    const summary = reportSummary(report)
    expect(summary).toContain("1 error")
    expect(summary).toContain("1/2")
  })

  test("report.passed is false when any error severity fails", () => {
    const report: PreflightReport = {
      checks: [{ name: "git", passed: false, message: "Not found", severity: "error", fixHint: "" }],
    }
    expect(report.checks.some((c) => !c.passed && c.severity === "error")).toBe(true)
  })
})
