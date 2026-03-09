import { describe, expect, it } from "bun:test"
import { parseFilePath, extractFilePathFromHref } from "./file-path"

describe("parseFilePath", () => {
  describe("Unix paths", () => {
    it("bare filename", () => {
      expect(parseFilePath("foo.ts")).toEqual({ path: "foo.ts", line: undefined, column: undefined })
    })

    it("relative path", () => {
      expect(parseFilePath("src/index.ts")).toEqual({ path: "src/index.ts", line: undefined, column: undefined })
    })

    it("dot-relative path", () => {
      expect(parseFilePath("./src/foo.ts")).toEqual({ path: "./src/foo.ts", line: undefined, column: undefined })
    })

    it("parent-relative path", () => {
      expect(parseFilePath("../lib/bar.ts")).toEqual({ path: "../lib/bar.ts", line: undefined, column: undefined })
    })

    it("absolute path", () => {
      expect(parseFilePath("/Users/dev/project/main.ts")).toEqual({
        path: "/Users/dev/project/main.ts",
        line: undefined,
        column: undefined,
      })
    })

    it("with line number", () => {
      expect(parseFilePath("src/foo.ts:42")).toEqual({ path: "src/foo.ts", line: 42, column: undefined })
    })

    it("with line and column", () => {
      expect(parseFilePath("src/foo.ts:42:10")).toEqual({ path: "src/foo.ts", line: 42, column: 10 })
    })

    it("deeply nested path", () => {
      expect(parseFilePath("packages/ui/src/context/marked.tsx")).toEqual({
        path: "packages/ui/src/context/marked.tsx",
        line: undefined,
        column: undefined,
      })
    })

    it("path with @ scope", () => {
      expect(parseFilePath("@scope/pkg/index.js")).toEqual({
        path: "@scope/pkg/index.js",
        line: undefined,
        column: undefined,
      })
    })

    it("dotfile with path", () => {
      expect(parseFilePath("src/.eslintrc.json")).toEqual({
        path: "src/.eslintrc.json",
        line: undefined,
        column: undefined,
      })
    })
  })

  describe("Windows paths", () => {
    it("drive letter with backslash", () => {
      expect(parseFilePath("C:\\Users\\dev\\file.ts")).toEqual({
        path: "C:\\Users\\dev\\file.ts",
        line: undefined,
        column: undefined,
      })
    })

    it("drive letter with forward slash", () => {
      expect(parseFilePath("C:/Users/dev/file.ts")).toEqual({
        path: "C:/Users/dev/file.ts",
        line: undefined,
        column: undefined,
      })
    })

    it("lowercase drive", () => {
      expect(parseFilePath("d:\\projects\\app.tsx")).toEqual({
        path: "d:\\projects\\app.tsx",
        line: undefined,
        column: undefined,
      })
    })

    it("UNC path", () => {
      expect(parseFilePath("\\\\server\\share\\file.ts")).toEqual({
        path: "\\\\server\\share\\file.ts",
        line: undefined,
        column: undefined,
      })
    })

    it("Windows path with line number", () => {
      expect(parseFilePath("C:\\src\\file.ts:12")).toEqual({ path: "C:\\src\\file.ts", line: 12, column: undefined })
    })

    it("Windows path with line and column", () => {
      expect(parseFilePath("C:\\src\\file.ts:12:5")).toEqual({ path: "C:\\src\\file.ts", line: 12, column: 5 })
    })
  })

  describe("rejects non-paths", () => {
    it("URL with protocol", () => {
      expect(parseFilePath("https://example.com/path.html")).toBeUndefined()
    })

    it("text with spaces", () => {
      expect(parseFilePath("not a path.ts")).toBeUndefined()
    })

    it("bare word without extension", () => {
      expect(parseFilePath("README")).toBeUndefined()
    })

    it("empty string", () => {
      expect(parseFilePath("")).toBeUndefined()
    })

    it("file:// URL", () => {
      expect(parseFilePath("file:///foo/bar.ts")).toBeUndefined()
    })

    it("just a number", () => {
      expect(parseFilePath("42")).toBeUndefined()
    })

    it("path without extension", () => {
      expect(parseFilePath("src/Makefile")).toBeUndefined()
    })
  })
})

describe("extractFilePathFromHref", () => {
  describe("accepts file-like hrefs", () => {
    it("bare filename", () => {
      expect(extractFilePathFromHref("AGENTS.md")).toBe("AGENTS.md")
    })

    it("relative path", () => {
      expect(extractFilePathFromHref("src/foo.ts")).toBe("src/foo.ts")
    })

    it("dot-relative path", () => {
      expect(extractFilePathFromHref("./README.md")).toBe("./README.md")
    })

    it("parent-relative path", () => {
      expect(extractFilePathFromHref("../docs/guide.md")).toBe("../docs/guide.md")
    })

    it("path with multiple extensions", () => {
      expect(extractFilePathFromHref("config.test.ts")).toBe("config.test.ts")
    })
  })

  describe("strips fragments and queries", () => {
    it("strips #fragment", () => {
      expect(extractFilePathFromHref("AGENTS.md#worktrees")).toBe("AGENTS.md")
    })

    it("strips ?query", () => {
      expect(extractFilePathFromHref("README.md?plain=1")).toBe("README.md")
    })

    it("strips both fragment and query", () => {
      expect(extractFilePathFromHref("docs/guide.md?v=2#section")).toBe("docs/guide.md")
    })

    it("strips fragment from path with directory", () => {
      expect(extractFilePathFromHref("src/foo.ts#L42")).toBe("src/foo.ts")
    })
  })

  describe("rejects URLs and schemes", () => {
    it("https URL", () => {
      expect(extractFilePathFromHref("https://example.com/path.html")).toBeUndefined()
    })

    it("http URL", () => {
      expect(extractFilePathFromHref("http://localhost:3000/index.html")).toBeUndefined()
    })

    it("mailto scheme", () => {
      expect(extractFilePathFromHref("mailto:user@example.com")).toBeUndefined()
    })

    it("tel scheme", () => {
      expect(extractFilePathFromHref("tel:+1234567890")).toBeUndefined()
    })

    it("javascript scheme", () => {
      expect(extractFilePathFromHref("javascript:void(0)")).toBeUndefined()
    })

    it("file:// URL", () => {
      expect(extractFilePathFromHref("file:///foo/bar.ts")).toBeUndefined()
    })

    it("ftp URL", () => {
      expect(extractFilePathFromHref("ftp://server/file.txt")).toBeUndefined()
    })

    it("custom scheme", () => {
      expect(extractFilePathFromHref("vscode://extension/id")).toBeUndefined()
    })
  })

  describe("rejects anchors and non-file values", () => {
    it("pure anchor", () => {
      expect(extractFilePathFromHref("#section")).toBeUndefined()
    })

    it("anchor with nested path", () => {
      expect(extractFilePathFromHref("#/some/path")).toBeUndefined()
    })

    it("empty string", () => {
      expect(extractFilePathFromHref("")).toBeUndefined()
    })

    it("no extension (bare word)", () => {
      expect(extractFilePathFromHref("README")).toBeUndefined()
    })

    it("directory-only path (no extension)", () => {
      expect(extractFilePathFromHref("src/components/")).toBeUndefined()
    })

    it("fragment-only after stripping resolves to empty", () => {
      // href is "#foo" — starts with # so rejected
      expect(extractFilePathFromHref("#foo.md")).toBeUndefined()
    })
  })
})
