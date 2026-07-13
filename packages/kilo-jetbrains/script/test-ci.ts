#!/usr/bin/env bun

/**
 * CI test runner for the JetBrains plugin.
 *
 * Runs ./gradlew clean test --continue --no-build-cache --stacktrace --console=plain
 * so all modules run even when some fail,
 * then collects per-module JUnit XML results into .artifacts/unit/junit.xml
 * so mikepenz/action-junit-report can find them at the standard path.
 * The generated OpenAPI client can otherwise restore stale compile outputs
 * when the spec changes without a clean build directory.
 *
 * Exits with Gradle's exit code on Linux/macOS so test failures fail the
 * repo-wide `bun turbo test:ci` run. On Windows, exits 0 regardless — IntelliJ
 * Swing/coroutine tests are inherently flaky on Windows and failing the job
 * there would be noisy; failures remain visible via JUnit report annotations.
 */

import { join } from "node:path"
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"

const root = join(import.meta.dir, "..")
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"
const args = ["clean", "test", "--continue", "--stacktrace", "--console=plain"]
const cmd = process.platform === "win32" ? ["cmd.exe", "/c", gradlew, ...args] : [gradlew, ...args]
const fallback = 45 * 60 * 1000
const parsed = Number(process.env.KILO_JETBRAINS_TEST_TIMEOUT_MS ?? fallback)
const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback

const proc = Bun.spawn(cmd, {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
const timer = setTimeout(() => {
  console.error(`[jetbrains-test] Gradle timed out after ${Math.round(timeout / 1000)}s`)
  proc.kill()
}, timeout)
const code = await proc.exited
clearTimeout(timer)

const modules = [".", "shared", "frontend", "backend"]
const suites: string[] = []

for (const mod of modules) {
  const dir = join(root, mod === "." ? "" : mod, "build", "test-results", "test")
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".xml")) continue
    // Strip leading XML declaration so it does not appear as a nested
    // declaration inside the <testsuites> wrapper, which would produce
    // malformed XML and fail the JUnit report uploader.
    const xml = readFileSync(join(dir, f), "utf8").replace(/^\s*<\?xml[^>]*\?>\s*/u, "")
    suites.push(xml)
  }
}

const out = join(root, ".artifacts", "unit", "junit.xml")
mkdirSync(join(root, ".artifacts", "unit"), { recursive: true })
writeFileSync(out, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join("\n")}\n</testsuites>\n`)

console.log(`[jetbrains-test] collected ${suites.length} suite(s) -> ${out}`)
if (code !== 0) {
  console.log(`[jetbrains-test] Gradle exited ${code} — failures visible in JUnit report`)
  if (process.platform !== "win32") process.exit(code)
}
