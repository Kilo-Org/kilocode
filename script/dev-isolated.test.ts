import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "../packages/cli/test/fixture/environment"

test("isolated dev passes the JSX preload and existing Bun options to standalone children", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo dev-standalone-"))
  const preload = path.join(root, "preload.ts")
  await Bun.write(
    preload,
    'console.error("KILO_DEV_PRELOAD", process.argv[2], process.execArgv.includes("--conditions=kilo-dev-test"))\n',
  )
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, "dev-isolated.ts"),
      "session",
      "list",
      "--standalone",
      "--format",
      "json",
    ],
    {
      cwd: root,
      env: isolatedEnv(root, {
        BUN_OPTIONS: `--preload ${preload.replace(/[\s\\"']/g, (char) => `\\${char}`)} --conditions=kilo-dev-test`,
        INIT_CWD: undefined,
        KILO_API_KEY: undefined,
        KILO_V2_PROFILE: path.join(root, "profile"),
        OPENCODE_PRINT_LOGS: "1",
      }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toContain("KILO_DEV_PRELOAD session true")
    expect(stderr).toContain("KILO_DEV_PRELOAD serve true")
    expect(stderr).not.toContain("Kilo login from v1 Kilo")
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual([])
  } finally {
    child.kill()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
