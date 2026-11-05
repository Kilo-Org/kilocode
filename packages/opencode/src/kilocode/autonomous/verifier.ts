import { Effect } from "effect"
import path from "path"
import { AutonomousShell } from "./shell"

/** Mechanical checks: detect the project's test/lint/typecheck commands and run them. */
export namespace AutonomousVerifier {
  export type Check = { name: string; command: string }
  export type Outcome = { check: Check; ok: boolean; code: number; output: string; ms: number; skipped?: string }
  export type Report = { ok: boolean; results: Outcome[] }

  const exists = (file: string) => Effect.promise(() => Bun.file(file).exists())
  const json = (file: string) =>
    Effect.promise(async () => {
      try {
        return (await Bun.file(file).json()) as Record<string, unknown>
      } catch {
        return undefined
      }
    })

  const runner = (dir: string) =>
    Effect.gen(function* () {
      if (yield* exists(path.join(dir, "bun.lock"))) return "bun"
      if (yield* exists(path.join(dir, "bun.lockb"))) return "bun"
      if (yield* exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm"
      if (yield* exists(path.join(dir, "yarn.lock"))) return "yarn"
      return "npm"
    })

  export const detect = Effect.fn("AutonomousVerifier.detect")(function* (dir: string) {
    const out: Check[] = []
    const pkg = yield* json(path.join(dir, "package.json"))
    if (pkg) {
      const scripts = (pkg.scripts ?? {}) as Record<string, string>
      const run = yield* runner(dir)
      const cmd = (name: string) => (run === "npm" ? `npm run ${name}` : `${run} run ${name}`)
      for (const name of ["typecheck", "lint", "test"]) {
        if (typeof scripts[name] === "string" && scripts[name].trim().length > 0) out.push({ name, command: cmd(name) })
      }
    }
    const pyFiles = ["pyproject.toml", "pytest.ini", "setup.cfg"]
    const pyHits = yield* Effect.forEach(pyFiles, (f) => exists(path.join(dir, f)))
    if (pyHits.some(Boolean)) {
      if (yield* exists(path.join(dir, "ruff.toml"))) out.push({ name: "lint", command: "ruff check ." })
      out.push({ name: "test", command: "pytest -q" })
    }
    if (yield* exists(path.join(dir, "pubspec.yaml"))) {
      out.push({ name: "analyze", command: "flutter analyze" })
      out.push({ name: "test", command: "flutter test" })
    }
    if (yield* exists(path.join(dir, "Cargo.toml"))) {
      out.push({ name: "check", command: "cargo check" })
      out.push({ name: "test", command: "cargo test" })
    }
    if (yield* exists(path.join(dir, "go.mod"))) {
      out.push({ name: "vet", command: "go vet ./..." })
      out.push({ name: "test", command: "go test ./..." })
    }
    return out satisfies Check[]
  })

  export const fromConfig = (commands: string[]): Check[] => commands.map((command, i) => ({ name: `check${i + 1}`, command }))

  /** First real program of a shell line, skipping `VAR=value` prefixes and a leading `cd dir &&`. */
  export function binary(command: string) {
    const program = (segment: string) => segment.trim().split(/\s+/).find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) ?? ""
    const parts = command.trim().split(/\s*(?:&&|;)\s*/)
    const first = parts.find((p) => program(p) !== "cd") ?? parts[0] ?? ""
    return program(first)
  }

  export const run = Effect.fn("AutonomousVerifier.run")(function* (input: { dir: string; checks: Check[]; timeout?: number }) {
    const results: Outcome[] = []
    for (const check of input.checks) {
      const bin = binary(check.command)
      if (bin && !Bun.which(bin)) {
        results.push({ check, ok: true, code: 0, output: "", ms: 0, skipped: `${bin} is not installed` })
        continue
      }
      const r = yield* AutonomousShell.sh(check.command, { cwd: input.dir, timeout: input.timeout ?? 10 * 60_000 })
      const output = AutonomousShell.truncate([r.stdout, r.stderr].filter((s) => s.trim().length).join("\n"))
      results.push({ check, ok: r.code === 0 && !r.timedOut, code: r.code, output: r.timedOut ? `${output}\n[timed out]` : output, ms: r.ms })
      if (r.code !== 0) break
    }
    return { ok: results.every((r) => r.ok), results } satisfies Report
  })

  export function summary(report: Report) {
    return report.results
      .map((r) => {
        if (r.skipped) return `${r.check.name} (${r.check.command}): skipped, ${r.skipped}`
        return `${r.check.name} (${r.check.command}): ${r.ok ? "passed" : `failed with exit ${r.code}`}${r.ok ? "" : `\n${r.output}`}`
      })
      .join("\n")
  }

  /** Normalised signature of the first failing check, for stuck detection. */
  export function fingerprint(report: Report) {
    const failed = report.results.find((r) => !r.ok)
    if (!failed) return ""
    const lines = failed.output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
    const hit = lines.find((l) => /error|fail|exception|panic|✗|×/i.test(l)) ?? lines[0] ?? ""
    return `${failed.check.name}:${hit.replace(/\d+/g, "N").replace(/\s+/g, " ").slice(0, 200)}`
  }
}
