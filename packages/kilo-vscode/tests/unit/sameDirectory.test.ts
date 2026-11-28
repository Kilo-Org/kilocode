import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { sameDirectory } from "../../src/kilo-provider-utils"

const platform = Object.getOwnPropertyDescriptor(process, "platform")

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform)
})

describe("sameDirectory", () => {
  it("matches identical paths", () => {
    expect(sameDirectory("/repo/pkg", "/repo/pkg")).toBe(true)
  })

  it("matches trailing slash differences", () => {
    expect(sameDirectory("/repo/pkg", "/repo/pkg/")).toBe(true)
  })

  it("matches Windows drive-letter case differences", () => {
    setPlatform("win32")
    expect(sameDirectory("C:/Repo/Work", "c:/repo/work")).toBe(true)
  })

  it("returns false for different directories", () => {
    expect(sameDirectory("/repo/pkg-a", "/repo/pkg-b")).toBe(false)
  })

  it("matches symlinked paths pointing to the same real directory", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-samedir-"))
    const real = path.join(base, "real")
    const other = path.join(base, "other")
    const link = path.join(base, "link")
    try {
      fs.mkdirSync(real)
      fs.mkdirSync(other)
      fs.symlinkSync(real, link, "dir")
      expect(sameDirectory(link, real)).toBe(true)
      expect(sameDirectory(real, link)).toBe(true)
      expect(sameDirectory(link, other)).toBe(false)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
