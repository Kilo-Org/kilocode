import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseCommand } from "../src/commands"

test("update accepts one explicit operation and rejects conflicting or unknown arguments", () => {
  expect(parseCommand(["update"])).toEqual({ type: "update", action: "apply" })
  for (const action of ["check", "apply", "rollback"] as const)
    expect(parseCommand(["update", `--${action}`])).toEqual({ type: "update", action })
  for (const args of [
    ["--check", "--apply"],
    ["--rollback", "--check"],
    ["--apply", "--rollback"],
    ["extra"],
    ["--force"],
  ])
    expect(() => parseCommand(["update", ...args])).toThrow()
})

test("unconfigured update CLI stays inert without opening a session store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-update-command-"))
  try {
    for (const action of ["--check", "--apply", "--rollback"]) {
      const child = Bun.spawn(
        [process.execPath, path.resolve(import.meta.dir, "../src/tui-preview.ts"), "update", action],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            HOME: root,
            XDG_CONFIG_HOME: path.join(root, "config"),
            XDG_DATA_HOME: path.join(root, "data"),
            XDG_CACHE_HOME: path.join(root, "cache"),
            XDG_STATE_HOME: path.join(root, "state"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(stderr).toBe("")
      expect(code).toBe(0)
      expect(JSON.parse(stdout).status).toBe("inert")
      expect((await readdir(root)).filter((entry) => entry !== "cache")).toEqual([])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
