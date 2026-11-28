import { expect, it } from "bun:test"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"

const cases = [
  {
    name: "tools",
    file: "worktree-tools.test.ts",
    env: (home: string) => ({
      HOME: home,
      XDG_CONFIG_HOME: home,
      KILO_REAL_GIT: Bun.which("git")!,
      PATH: "/usr/bin:/bin",
    }),
  },
  {
    name: "readiness",
    file: "worktree-readiness.test.ts",
    env: (home: string) => ({ HOME: home, XDG_CONFIG_HOME: home, KILO_READINESS_HOME: home }),
  },
]

it.each(cases)(
  "runs the $name fixture with an isolated HOME",
  async (item) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), `kilo-${item.name}-home-`))
    try {
      const child = Bun.spawn([process.execPath, "test", path.resolve(import.meta.dir, "../fixtures", item.file)], {
        env: { ...process.env, ...item.env(home) },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code, stdout + stderr).toBe(0)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  },
  120_000,
)
