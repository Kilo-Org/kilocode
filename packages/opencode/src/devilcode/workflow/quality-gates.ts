// packages/opencode/src/devilcode/workflow/quality-gates.ts
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"

export type QualityGate = {
  name: string
  command: string
  args: string[]
}

export type GateResult = {
  gateName: string
  passed: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false)
}

function truncateTail(s: string, maxChars: number = 2000): string {
  return s.length <= maxChars ? s : s.slice(-maxChars)
}

export async function detectGates(projectRoot: string): Promise<QualityGate[]> {
  const gates: QualityGate[] = []

  // Check package.json scripts
  const pkgPath = path.join(projectRoot, "package.json")
  if (await fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))
      const scripts = pkg.scripts ?? {}

      if (scripts.typecheck) {
        gates.push({ name: "TypeCheck", command: "npm", args: ["run", "typecheck"] })
      } else if (await fileExists(path.join(projectRoot, "tsconfig.json"))) {
        gates.push({ name: "TypeCheck", command: "npx", args: ["tsc", "--noEmit"] })
      }

      if (scripts.test) {
        gates.push({ name: "Test Suite", command: "npm", args: ["test", "--", "--run"] })
      }

      if (scripts.lint) {
        gates.push({ name: "Lint", command: "npm", args: ["run", "lint"] })
      }
    } catch {
      // malformed package.json
    }
  }

  // Check Cargo.toml
  if (await fileExists(path.join(projectRoot, "Cargo.toml"))) {
    gates.push({ name: "Cargo Test", command: "cargo", args: ["test"] })
    gates.push({ name: "Cargo Clippy", command: "cargo", args: ["clippy", "--", "-W", "clippy::all"] })
  }

  // Check Python
  if (
    (await fileExists(path.join(projectRoot, "pyproject.toml"))) ||
    (await fileExists(path.join(projectRoot, "setup.py")))
  ) {
    gates.push({ name: "Pytest", command: "python", args: ["-m", "pytest"] })
  }

  return gates
}

export async function runGate(gate: QualityGate, cwd: string): Promise<GateResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const proc = spawn(gate.command, gate.args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("close", (code) => {
      resolve({
        gateName: gate.name,
        passed: code === 0,
        exitCode: code ?? 1,
        stdout: truncateTail(stdout),
        stderr: truncateTail(stderr),
        durationMs: Date.now() - start,
      })
    })
    proc.on("error", () => {
      resolve({
        gateName: gate.name,
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: `Command not found: ${gate.command}`,
        durationMs: Date.now() - start,
      })
    })
  })
}

export async function runAllGates(gates: QualityGate[], cwd: string): Promise<GateResult[]> {
  const results: GateResult[] = []
  for (const gate of gates) {
    results.push(await runGate(gate, cwd))
  }
  return results
}

export function summarizeGateFailures(results: GateResult[]): string {
  const failures = results.filter((r) => !r.passed)
  if (failures.length === 0) return ""
  return failures.map((f) => `FAILED: ${f.gateName} (exit ${f.exitCode})\n${f.stderr || f.stdout}`).join("\n---\n")
}
