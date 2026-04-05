import { describe, it, expect } from "bun:test"
import { extractDiffInfo } from "../../src/services/autocomplete/context/visible-code-utils"

describe("extractDiffInfo", () => {
  it("extracts info for git scheme with ref query param", () => {
    const result = extractDiffInfo("git", "ref=HEAD", "/workspace/foo.ts")
    expect(result).not.toBeUndefined()
    expect(result?.scheme).toBe("git")
    expect(result?.side).toBe("old")
    expect(result?.gitRef).toBe("HEAD")
    expect(result?.originalPath).toBe("/workspace/foo.ts")
  })

  it("extracts info for gitfs scheme", () => {
    const result = extractDiffInfo("gitfs", "ref=abc123", "/workspace/bar.ts")
    expect(result?.scheme).toBe("gitfs")
    expect(result?.gitRef).toBe("abc123")
  })

  it("extracts ref with additional query params", () => {
    const result = extractDiffInfo("git", "ref=main&other=value", "/f.ts")
    expect(result?.gitRef).toBe("main")
  })

  it("extracts commit SHA as ref", () => {
    const result = extractDiffInfo("git", "ref=a1b2c3d4e5f6", "/f.ts")
    expect(result?.gitRef).toBe("a1b2c3d4e5f6")
  })

  it("handles git scheme with no query (no ref)", () => {
    const result = extractDiffInfo("git", "", "/f.ts")
    expect(result).not.toBeUndefined()
    expect(result?.gitRef).toBeUndefined()
  })

  it("returns undefined for file scheme", () => {
    expect(extractDiffInfo("file", "", "/f.ts")).toBeUndefined()
  })

  it("returns undefined for unknown scheme", () => {
    expect(extractDiffInfo("https", "", "/f.ts")).toBeUndefined()
  })

  it("returns undefined for vscode-remote scheme", () => {
    expect(extractDiffInfo("vscode-remote", "", "/f.ts")).toBeUndefined()
  })
})
