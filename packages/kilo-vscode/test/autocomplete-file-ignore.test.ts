import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { FileIgnoreController } from "../src/services/autocomplete/shims/FileIgnoreController"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ignore-"))
const real = path.join(root, "real")
const link = path.join(root, "link")
fs.mkdirSync(real)
fs.symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir")
fs.writeFileSync(path.join(real, "math.ts"), "export const a = 1\n")
fs.writeFileSync(path.join(real, ".env"), "SECRET=1\n")
fs.writeFileSync(path.join(root, "outside.ts"), "\n")

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("FileIgnoreController", () => {
  test("allows workspace files when the workspace path is a symlink", async () => {
    const controller = new FileIgnoreController(link)
    await controller.initialize()
    expect(controller.validateAccess(path.join(link, "math.ts"))).toBe(true)
    // A file that does not exist yet cannot be resolved, so it takes the unresolved branch.
    expect(controller.validateAccess(path.join(link, "new-file.ts"))).toBe(true)
  })

  test("still denies sensitive files and files outside the workspace", async () => {
    const controller = new FileIgnoreController(link)
    await controller.initialize()
    expect(controller.validateAccess(path.join(link, ".env"))).toBe(false)
    expect(controller.validateAccess(path.join(root, "outside.ts"))).toBe(false)
    expect(controller.validateAccess(path.join(link, "..", "outside.ts"))).toBe(false)
  })

  test("denies all access without a workspace", async () => {
    const controller = new FileIgnoreController()
    await controller.initialize()
    expect(controller.validateAccess(path.join(real, "math.ts"))).toBe(false)
  })
})
