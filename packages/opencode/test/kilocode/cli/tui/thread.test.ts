import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../../fixture/fixture"
import { resolveThreadDirectory } from "../../../../src/cli/cmd/tui/thread"

describe("kilo tui thread", () => {
  test("ignores stale PWD after cwd is changed by a process wrapper", async () => {
    await using root = await tmpdir()
    const pkg = path.join(root.path, "packages", "opencode")
    await fs.mkdir(pkg, { recursive: true })

    expect(resolveThreadDirectory(".", root.path, pkg)).toBe(pkg)
  })

  test("uses kilo-dev caller directory when running through package cwd", async () => {
    await using root = await tmpdir()
    const pkg = path.join(root.path, "packages", "opencode")
    await fs.mkdir(pkg, { recursive: true })

    const prev = process.env.KILO_DEV_CWD
    process.env.KILO_DEV_CWD = root.path
    try {
      expect(resolveThreadDirectory(".", root.path, pkg)).toBe(root.path)
      expect(resolveThreadDirectory(undefined, root.path, pkg)).toBe(root.path)
    } finally {
      if (prev === undefined) delete process.env.KILO_DEV_CWD
      else process.env.KILO_DEV_CWD = prev
    }
  })
})
