import { expect, it } from "bun:test"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"

it("runs real-git readiness checks with process-isolated HOME and Git environment", async () => {
  const env = { ...process.env }
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-ready-home-"))
  try {
    const child = Bun.spawn(
      [process.execPath, "test", path.resolve(import.meta.dir, "../fixtures/worktree-readiness.test.ts")],
      {
        env: { ...env, HOME: home, XDG_CONFIG_HOME: home, KILO_READINESS_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stdout + stderr).toBe(0)
    expect(process.env).toEqual(env)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
}, 60_000)
