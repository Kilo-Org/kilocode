import { beforeEach, describe, expect, it, mock } from "bun:test"
import * as path from "path"

const realpath = mock(async (input: string) => input)

mock.module("fs/promises", () => ({
  realpath,
}))

const { isWindowsDrivePath, normalizeLegacyPath } = await import("../../../src/legacy-migration/sessions/lib/path")

describe("legacy migration path", () => {
  beforeEach(() => {
    realpath.mockReset()
    realpath.mockImplementation(async (input: string) => input)
  })

  it("returns an empty string for empty legacy paths", async () => {
    expect(await normalizeLegacyPath("   ")).toBe("")
    expect(realpath).not.toHaveBeenCalled()
  })

  it("detects Windows drive paths without relying on runtime platform", () => {
    expect(isWindowsDrivePath("c:\\repo")).toBe(true)
    expect(isWindowsDrivePath("C:/repo")).toBe(true)
    expect(isWindowsDrivePath("/repo")).toBe(false)
  })

  it("uppercases the Windows drive letter before resolving the final path", async () => {
    realpath.mockImplementation(async (input: string) => input)

    const value = await normalizeLegacyPath("c:/repo/../repo/file.txt")
    const expected = path.normalize(path.resolve("c:/repo/../repo/file.txt"))

    expect(realpath).toHaveBeenCalledTimes(1)
    expect(realpath.mock.calls[0]?.[0]).toBe(expected.replace(/^c:/, "C:"))
    expect(value).toBe(expected.replace(/^c:/, "C:"))
  })

  it("falls back to the normalized path when realpath fails", async () => {
    realpath.mockRejectedValueOnce(new Error("missing"))

    const input = "C:/repo/./child"
    const value = await normalizeLegacyPath(input)

    expect(value).toBe(path.normalize(path.resolve(input)))
  })
})
