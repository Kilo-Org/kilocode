import { expect, test } from "bun:test"
import fs from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PlanFile } from "../src/plan/plan-file"

test("creates a missing nested plan directory and is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-plan-dir-"))
  try {
    const dir = path.join(root, "a", ".kilo2", "plans")
    PlanFile.ensure(dir)
    PlanFile.ensure(dir)
    expect(fs.statSync(dir).isDirectory()).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
