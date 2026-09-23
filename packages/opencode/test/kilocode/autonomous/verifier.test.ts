import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AutonomousVerifier } from "@/kilocode/autonomous/verifier"

const tmp = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-verifier-"))
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body)
  return dir
}

describe("AutonomousVerifier", () => {
  test("detects package.json scripts with the right runner", async () => {
    const dir = tmp({ "package.json": JSON.stringify({ scripts: { test: "x", lint: "y", build: "z" } }), "bun.lock": "" })
    const checks = await Effect.runPromise(AutonomousVerifier.detect(dir))
    expect(checks).toEqual([
      { name: "lint", command: "bun run lint" },
      { name: "test", command: "bun run test" },
    ])
  })

  test("detects python, flutter, cargo and go projects", async () => {
    expect(await Effect.runPromise(AutonomousVerifier.detect(tmp({ "pyproject.toml": "", "ruff.toml": "" })))).toEqual([
      { name: "lint", command: "ruff check ." },
      { name: "test", command: "pytest -q" },
    ])
    expect((await Effect.runPromise(AutonomousVerifier.detect(tmp({ "pubspec.yaml": "" })))).map((c) => c.command)).toEqual(["flutter analyze", "flutter test"])
    expect((await Effect.runPromise(AutonomousVerifier.detect(tmp({ "Cargo.toml": "" })))).map((c) => c.command)).toEqual(["cargo check", "cargo test"])
    expect((await Effect.runPromise(AutonomousVerifier.detect(tmp({ "go.mod": "" })))).map((c) => c.command)).toEqual(["go vet ./...", "go test ./..."])
    expect(await Effect.runPromise(AutonomousVerifier.detect(tmp({})))).toEqual([])
  })

  test("runs checks, stops at the first failure, and fingerprints it", async () => {
    const dir = tmp({})
    const report = await Effect.runPromise(
      AutonomousVerifier.run({
        dir,
        checks: [
          { name: "ok", command: "echo fine" },
          { name: "bad", command: "echo 'FAIL greet.test.ts line 12' >&2; exit 3" },
          { name: "never", command: "echo unreachable" },
        ],
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.results.map((r) => [r.check.name, r.ok, r.code])).toEqual([
      ["ok", true, 0],
      ["bad", false, 3],
    ])
    expect(AutonomousVerifier.fingerprint(report)).toBe("bad:FAIL greet.test.ts line N")
    expect(AutonomousVerifier.summary(report)).toContain("failed with exit 3")
  })

  test("skips checks whose binary is missing", async () => {
    const report = await Effect.runPromise(
      AutonomousVerifier.run({ dir: tmp({}), checks: [{ name: "x", command: "definitely-not-a-binary-xyz --version" }] }),
    )
    expect(report.ok).toBe(true)
    expect(report.results[0]?.skipped).toContain("not installed")
    expect(AutonomousVerifier.fromConfig(["bun test"])).toEqual([{ name: "check1", command: "bun test" }])
  })
})
