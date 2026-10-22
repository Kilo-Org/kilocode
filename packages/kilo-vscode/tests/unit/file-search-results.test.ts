import { describe, expect, it } from "bun:test"
import { mergeFileSearchResults } from "../../src/kilo-provider/file-search-results"

describe("mergeFileSearchResults", () => {
  it("returns backend results when no open files", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts", "src/b.ts"],
      open: new Set(),
    })
    expect(result).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("places open files before backend results", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts", "src/b.ts", "src/c.ts"],
      open: new Set(["src/c.ts", "src/d.ts"]),
    })
    expect(result).toEqual(["src/c.ts", "src/d.ts", "src/a.ts", "src/b.ts"])
  })

  it("places active file first among open files", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts"],
      open: new Set(["src/b.ts", "src/c.ts"]),
      active: "src/c.ts",
    })
    expect(result).toEqual(["src/c.ts", "src/b.ts", "src/a.ts"])
  })

  it("ignores active file when it is not in open set", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts"],
      open: new Set(["src/b.ts"]),
      active: "src/x.ts",
    })
    expect(result).toEqual(["src/b.ts", "src/a.ts"])
  })

  it("deduplicates open files from backend results", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts", "src/b.ts"],
      open: new Set(["src/a.ts"]),
    })
    expect(result).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("filters open files by query", () => {
    const result = mergeFileSearchResults({
      query: "config",
      backend: ["src/config.ts", "src/util.ts"],
      open: new Set(["src/index.ts", "src/config.ts", "README.md"]),
    })
    expect(result).toEqual(["src/config.ts", "src/util.ts"])
  })

  it("query filtering is case-insensitive", () => {
    const result = mergeFileSearchResults({
      query: "READ",
      backend: [],
      open: new Set(["README.md", "src/index.ts"]),
    })
    expect(result).toEqual(["README.md"])
  })

  it("shows all open files on empty query", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: [],
      open: new Set(["src/a.ts", "src/b.ts"]),
    })
    expect(result).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("shows all open files on whitespace-only query", () => {
    const result = mergeFileSearchResults({
      query: "  ",
      backend: ["src/x.ts"],
      open: new Set(["src/a.ts"]),
    })
    expect(result).toEqual(["src/a.ts", "src/x.ts"])
  })

  it("handles forward-slash paths (Windows-normalized)", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/utils/path.ts"],
      open: new Set(["src/utils/path.ts", "src/index.ts"]),
      active: "src/utils/path.ts",
    })
    expect(result).toEqual(["src/utils/path.ts", "src/index.ts"])
  })

  it("normalizes backslash paths before filtering and deduping", () => {
    const result = mergeFileSearchResults({
      query: "utils/path",
      backend: ["src\\utils\\path.ts"],
      open: new Set(["src/utils/path.ts"]),
      active: "src\\utils\\path.ts",
    })
    expect(result).toEqual(["src/utils/path.ts"])
  })

  it("includes open tabs that fuzzy-match but are not substring matches", () => {
    const result = mergeFileSearchResults({
      query: "authn",
      backend: [],
      open: new Set(["authentication.ts", "unrelated.ts"]),
    })
    expect(result).toContain("authentication.ts")
    expect(result).not.toContain("unrelated.ts")
  })

  it("ranks open tabs by fuzzy match quality, not insertion order", () => {
    const result = mergeFileSearchResults({
      query: "auth",
      backend: [],
      open: new Set(["long-authentication-module.ts", "auth.ts"]),
    })
    expect(result[0]).toBe("auth.ts")
  })

  it("ranks open tabs by filename before directory matches", () => {
    const result = mergeFileSearchResults({
      query: "provider",
      backend: [],
      open: new Set(["src/provider/auth.ts", "src/provider.ts"]),
    })
    expect(result).toEqual(["src/provider.ts", "src/provider/auth.ts"])
  })

  it("boosts backend results where query matches the basename over full-path matches", () => {
    const result = mergeFileSearchResults({
      query: "auth",
      backend: ["src/authentication-module.ts", "packages/a/b/c/d/auth.ts"],
      open: new Set(),
    })
    expect(result.indexOf("packages/a/b/c/d/auth.ts")).toBeLessThan(result.indexOf("src/authentication-module.ts"))
  })

  it("uses path depth as tiebreaker when basename scores are equal", () => {
    const result = mergeFileSearchResults({
      query: "auth",
      backend: ["a/b/c/d/e/auth-service.ts", "src/auth-service.ts"],
      open: new Set(),
    })
    expect(result.indexOf("src/auth-service.ts")).toBeLessThan(result.indexOf("a/b/c/d/e/auth-service.ts"))
  })

  it("uses filename length as tiebreaker before path depth", () => {
    const result = mergeFileSearchResults({
      query: "auth",
      backend: ["src/authentication-module.ts", "a/b/c/auth.ts"],
      open: new Set(),
    })
    expect(result[0]).toBe("a/b/c/auth.ts")
  })

  it("preserves camel-case scoring for acronym-style queries", () => {
    const result = mergeFileSearchResults({
      query: "amprov",
      backend: [
        "packages/kilo-docs/pages/contributing/architecture/onboarding-improvements.md",
        "packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts",
      ],
      open: new Set(),
    })
    expect(result[0]).toBe("packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts")
  })
})
