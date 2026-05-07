import { describe, expect, it } from "bun:test"
import { normalizeDiffStyle, resolveOpenFileInput } from "../../src/kilo-provider/vscode-actions-utils"

describe("normalizeDiffStyle", () => {
  it("keeps split style", () => {
    expect(normalizeDiffStyle("split")).toBe("split")
  })

  it("falls back to unified for every other value", () => {
    expect(normalizeDiffStyle("unified")).toBe("unified")
    expect(normalizeDiffStyle(undefined)).toBe("unified")
    expect(normalizeDiffStyle("side-by-side")).toBe("unified")
  })
})

describe("resolveOpenFileInput", () => {
  it("classifies absolute paths", () => {
    expect(resolveOpenFileInput("/repo/src/file.ts")).toEqual({ type: "absolute", path: "/repo/src/file.ts" })
  })

  it("classifies relative paths", () => {
    expect(resolveOpenFileInput("src/file.ts")).toEqual({ type: "relative", path: "src/file.ts" })
  })

  it("classifies Windows absolute paths", () => {
    expect(resolveOpenFileInput("C:\\repo\\src\\file.ts")).toEqual({
      type: "absolute",
      path: "C:\\repo\\src\\file.ts",
    })
  })
})
