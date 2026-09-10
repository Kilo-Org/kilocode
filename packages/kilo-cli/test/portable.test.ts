import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { requireRuntime } from "../src/runtime"

// Package-isolated portable smoke: build + relocate + run the loopback Gateway Auto flow from
// the relocated artifact in an isolated env. Reuses script/portable-smoke.ts so the test is a
// thin wrapper over the same entry the CLI exposes.
const cliRoot = path.resolve(import.meta.dir, "..")
// Use the EXECUTING supported runtime (validated by requireRuntime), not a canonical dist
// wrapper path — the executing interpreter is guaranteed present; a dist path is not.
requireRuntime()
const runtime = process.execPath

// Safety regression: the builder must REFUSE an existing output directory and delete nothing —
// not the sentinel inside it, and never an inherited path (the executing runtime must survive).
// This exercises the exclusive-mkdir guard, which runs before any bundling or copying.
test("portable build refuses an existing output directory and deletes nothing", async () => {
  if (process.platform === "win32") return
  const existing = await mkdtemp(path.join(os.tmpdir(), "kilo-portable-existing-"))
  const sentinel = path.join(existing, "sentinel.txt")
  try {
    await writeFile(sentinel, "keep-me")
    const child = Bun.spawn(
      [runtime, "--no-env-file", path.join(cliRoot, "script/build-portable.ts"), existing],
      { cwd: cliRoot, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 15000, killSignal: "SIGTERM" },
    )
    const [code, , stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code).not.toBe(0)
    expect(stderr).toMatch(/already exists|refusing/i)
    expect(await readFile(sentinel, "utf8")).toBe("keep-me")
    expect(existsSync(runtime)).toBe(true)
  } finally {
    await rm(existing, { recursive: true, force: true })
  }
}, 20000)

// Accepted no-install builder: the combined runner relocates the artifact and
// verifies both native Auto routes and the mounted Kilo TUI prompt/reply path.
test("portable artifact runs the loopback Gateway Auto flow relocated", async () => {
  const child = Bun.spawn([runtime, "--no-env-file", path.join(cliRoot, "script/portable-smoke.ts")], {
    cwd: cliRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 120000,
    killSignal: "SIGTERM",
  })
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, `${stdout}\n${stderr}`).toBe(0)
    expect(stdout).toContain("KILO_PORTABLE_SMOKE_RUNNER_OK")
  } finally {
    child.kill("SIGTERM")
    await child.exited
  }
}, 130000)
