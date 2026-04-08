import { spawn } from "child_process"
import fs from "fs/promises"

export type CheckResult = {
  name: string
  passed: boolean
  message: string
  severity: "error" | "warning"
  fixHint: string
}

export type PreflightReport = {
  checks: CheckResult[]
}

function exec(command: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }))
    proc.on("error", () => resolve({ code: 1, stdout: "", stderr: "command not found" }))
  })
}

export async function checkGitInstalled(): Promise<CheckResult> {
  const result = await exec("git", ["--version"])
  return {
    name: "git",
    passed: result.code === 0,
    message: result.code === 0 ? result.stdout : "git not found",
    severity: "error",
    fixHint: result.code !== 0 ? "Install git: https://git-scm.com" : "",
  }
}

export async function checkGitRepo(cwd: string): Promise<CheckResult> {
  const result = await exec("git", ["rev-parse", "--git-dir"], cwd)
  return {
    name: "git_repo",
    passed: result.code === 0,
    message: result.code === 0 ? "Valid git repository" : "Not a git repository",
    severity: "error",
    fixHint: result.code !== 0 ? "Run 'git init' or navigate to a git repository" : "",
  }
}

export async function checkBaseBranch(cwd: string, branch: string = "main"): Promise<CheckResult> {
  const local = await exec("git", ["rev-parse", "--verify", branch], cwd)
  if (local.code === 0) {
    return { name: "base_branch", passed: true, message: `Branch "${branch}" exists`, severity: "error", fixHint: "" }
  }
  const remote = await exec("git", ["rev-parse", "--verify", `origin/${branch}`], cwd)
  if (remote.code === 0) {
    return {
      name: "base_branch",
      passed: true,
      message: `Remote branch "origin/${branch}" exists`,
      severity: "error",
      fixHint: "",
    }
  }
  return {
    name: "base_branch",
    passed: false,
    message: `Branch "${branch}" not found locally or remotely`,
    severity: "error",
    fixHint: `Ensure the base branch "${branch}" exists`,
  }
}

export async function checkDiskSpace(): Promise<CheckResult> {
  try {
    const stats = await fs.statfs(process.cwd())
    const freeBytes = stats.bfree * stats.bsize
    const freeGB = freeBytes / (1024 * 1024 * 1024)
    if (freeGB < 1) {
      return {
        name: "disk_space",
        passed: false,
        message: `${freeGB.toFixed(1)} GB free disk space (< 1 GB)`,
        severity: "error",
        fixHint: "Free up disk space",
      }
    }
    if (freeGB < 5) {
      return {
        name: "disk_space",
        passed: true,
        message: `${freeGB.toFixed(1)} GB free disk space (low)`,
        severity: "warning",
        fixHint: "Consider freeing disk space",
      }
    }
    return { name: "disk_space", passed: true, message: `${freeGB.toFixed(1)} GB free disk space`, severity: "error", fixHint: "" }
  } catch {
    return { name: "disk_space", passed: true, message: "Unable to check disk space", severity: "warning", fixHint: "" }
  }
}

export async function checkWorkingTree(cwd: string): Promise<CheckResult> {
  const result = await exec("git", ["status", "--porcelain"], cwd)
  const clean = result.code === 0 && result.stdout.length === 0
  return {
    name: "working_tree",
    passed: true,
    message: clean ? "Clean working tree" : "Uncommitted changes detected",
    severity: "warning",
    fixHint: clean ? "" : "Consider committing or stashing changes before starting workflow",
  }
}

export async function runPreflight(cwd: string, baseBranch: string = "main"): Promise<PreflightReport> {
  const checks = await Promise.all([
    checkGitInstalled(),
    checkGitRepo(cwd),
    checkBaseBranch(cwd, baseBranch),
    checkDiskSpace(),
    checkWorkingTree(cwd),
  ])
  return { checks }
}

export function reportSummary(report: PreflightReport): string {
  const passed = report.checks.filter((c) => c.passed).length
  const total = report.checks.length
  const errors = report.checks.filter((c) => !c.passed && c.severity === "error").length
  const warnings = report.checks.filter((c) => !c.passed && c.severity === "warning").length
  return `Pre-flight: ${errors} error(s), ${warnings} warning(s) (${passed}/${total} checks passed)`
}

export function preflightPassed(report: PreflightReport): boolean {
  return !report.checks.some((c) => !c.passed && c.severity === "error")
}
