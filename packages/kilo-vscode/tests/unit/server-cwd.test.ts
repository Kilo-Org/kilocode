import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { ensureServerCwd } from "../../src/services/cli-backend/server-utils"

describe("ensureServerCwd", () => {
  it("accepts an existing filesystem root", () => {
    const root = path.parse(process.cwd()).root
    expect(() => ensureServerCwd(root)).not.toThrow()
  })

  it("creates a missing storage directory and its parents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-server-cwd-"))
    try {
      const dir = path.join(root, "storage", "kilo-code")
      ensureServerCwd(dir)
      expect(fs.statSync(dir).isDirectory()).toBe(true)
      expect(() => ensureServerCwd(dir)).not.toThrow()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("propagates failures to create a missing directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-server-cwd-"))
    try {
      const file = path.join(root, "file")
      fs.writeFileSync(file, "")
      expect(() => ensureServerCwd(path.join(file, "storage"))).toThrow()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
