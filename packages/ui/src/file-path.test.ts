// kilocode_change - new file
import { describe, expect, it } from "bun:test"
import { extractSuffix, normalizeCandidatePath, extractFilePathFromHref } from "./file-path"

describe("extractSuffix", () => {
  it("no suffix", () => {
    expect(extractSuffix("src/foo.ts")).toEqual({ candidate: "src/foo.ts" })
  })

  it("line only", () => {
    expect(extractSuffix("src/foo.ts:42")).toEqual({ candidate: "src/foo.ts", line: 42 })
  })

  it("line and column", () => {
    expect(extractSuffix("src/foo.ts:42:10")).toEqual({ candidate: "src/foo.ts", line: 42, column: 10 })
  })

  it("line range (extracts start line)", () => {
    expect(extractSuffix("src/index.ts:1-30")).toEqual({ candidate: "src/index.ts", line: 1 })
  })

  it("line range with column", () => {
    expect(extractSuffix("src/index.ts:10-21:5")).toEqual({ candidate: "src/index.ts", line: 10, column: 5 })
  })

  it("bare word", () => {
    expect(extractSuffix("LICENSE")).toEqual({ candidate: "LICENSE" })
  })

  it("dotfile", () => {
    expect(extractSuffix(".gitignore")).toEqual({ candidate: ".gitignore" })
  })

  it("Windows drive path with line", () => {
    expect(extractSuffix("C:\\src\\file.ts:12")).toEqual({ candidate: "C:\\src\\file.ts", line: 12 })
  })

  it("path with @ scope", () => {
    expect(extractSuffix("@scope/pkg/index.js:5")).toEqual({ candidate: "@scope/pkg/index.js", line: 5 })
  })

  it("empty string", () => {
    expect(extractSuffix("")).toEqual({ candidate: "" })
  })
})

describe("normalizeCandidatePath", () => {
  it("bare filename gets ./ prefix", () => {
    expect(normalizeCandidatePath("LICENSE")).toBe("./LICENSE")
  })

  it("bare relative path gets ./ prefix", () => {
    expect(normalizeCandidatePath("src/foo.ts")).toBe("./src/foo.ts")
  })

  it("dotfile gets ./ prefix", () => {
    expect(normalizeCandidatePath(".gitignore")).toBe("./.gitignore")
  })

  it("./ prefix preserved", () => {
    expect(normalizeCandidatePath("./LICENSE")).toBe("./LICENSE")
  })

  it("../ prefix preserved", () => {
    expect(normalizeCandidatePath("../lib/bar.ts")).toBe("../lib/bar.ts")
  })

  it("absolute unix path preserved", () => {
    expect(normalizeCandidatePath("/usr/bin/env")).toBe("/usr/bin/env")
  })

  it("Windows drive path preserved", () => {
    expect(normalizeCandidatePath("C:\\src\\file.ts")).toBe("C:\\src\\file.ts")
  })

  it("UNC path preserved", () => {
    expect(normalizeCandidatePath("\\\\server\\share")).toBe("\\\\server\\share")
  })

  it("preserves a/ as a real workspace directory", () => {
    expect(normalizeCandidatePath("a/src/app.ts")).toBe("./a/src/app.ts")
  })

  it("preserves b/ as a real workspace directory", () => {
    expect(normalizeCandidatePath("b/src/app.ts")).toBe("./b/src/app.ts")
  })

  it("Windows forward-slash drive path preserved", () => {
    expect(normalizeCandidatePath("C:/src/file.ts")).toBe("C:/src/file.ts")
  })

  it("single letter not treated as diff prefix", () => {
    // "c/foo" should NOT strip "c/" — only "a/" and "b/" are diff prefixes
    expect(normalizeCandidatePath("c/foo.ts")).toBe("./c/foo.ts")
  })
})

describe("extractFilePathFromHref", () => {
  describe("accepts file-like hrefs", () => {
    it("bare filename", () => {
      expect(extractFilePathFromHref("AGENTS.md")).toEqual({ path: "AGENTS.md" })
    })

    it("common extensionless workspace filename", () => {
      expect(extractFilePathFromHref("LICENSE")).toEqual({ path: "LICENSE" })
      expect(extractFilePathFromHref("Dockerfile")).toEqual({ path: "Dockerfile" })
      expect(extractFilePathFromHref("Makefile")).toEqual({ path: "Makefile" })
    })

    it("relative path", () => {
      expect(extractFilePathFromHref("src/foo.ts")).toEqual({ path: "src/foo.ts" })
    })

    it("dot-relative path", () => {
      expect(extractFilePathFromHref("./README.md")).toEqual({ path: "./README.md" })
    })

    it("parent-relative path", () => {
      expect(extractFilePathFromHref("../docs/guide.md")).toEqual({ path: "../docs/guide.md" })
    })
  })

  describe("file:// URLs return the decoded path", () => {
    it("file:// URL on Unix", () => {
      expect(extractFilePathFromHref("file:///foo/bar.ts")).toEqual({ path: "/foo/bar.ts" })
    })

    it("file:// URL with Windows drive", () => {
      expect(extractFilePathFromHref("file:///C:/Users/dev/file.ts")).toEqual({ path: "C:/Users/dev/file.ts" })
    })

    it("file:// URL with encoded characters", () => {
      expect(extractFilePathFromHref("file:///foo%20bar/baz.ts")).toEqual({ path: "/foo bar/baz.ts" })
    })
  })

  describe("extracts line and column", () => {
    it("path with line", () => {
      expect(extractFilePathFromHref("src/foo.ts:42")).toEqual({ path: "src/foo.ts", line: 42 })
    })

    it("path with line and column", () => {
      expect(extractFilePathFromHref("src/foo.ts:42:10")).toEqual({ path: "src/foo.ts", line: 42, column: 10 })
    })

    it("path with line range", () => {
      expect(extractFilePathFromHref("src/index.ts:1-30")).toEqual({ path: "src/index.ts", line: 1 })
    })

    it("Windows path with line and column", () => {
      expect(extractFilePathFromHref("C:\\src\\file.ts:12:5")).toEqual({
        path: "C:\\src\\file.ts",
        line: 12,
        column: 5,
      })
    })
  })

  describe("strips fragments and queries", () => {
    it("strips #fragment", () => {
      expect(extractFilePathFromHref("AGENTS.md#worktrees")).toEqual({ path: "AGENTS.md" })
    })

    it("strips ?query", () => {
      expect(extractFilePathFromHref("README.md?plain=1")).toEqual({ path: "README.md" })
    })

    it("preserves a/ as a real workspace directory", () => {
      expect(extractFilePathFromHref("a/src/app.ts")).toEqual({ path: "a/src/app.ts" })
    })

    it("preserves b/ as a real workspace directory with line", () => {
      expect(extractFilePathFromHref("b/src/app.ts:42")).toEqual({ path: "b/src/app.ts", line: 42 })
    })
  })

  describe("rejects relative hrefs that do not look like files", () => {
    it("extensionless relative doc link", () => {
      expect(extractFilePathFromHref("docs/getting-started")).toBeUndefined()
    })

    it("extensionless absolute docs path", () => {
      expect(extractFilePathFromHref("/docs")).toBeUndefined()
    })

    it("unknown extensionless filename", () => {
      expect(extractFilePathFromHref("README")).toBeUndefined()
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

    it("ftp URL", () => {
      expect(extractFilePathFromHref("ftp://server/file.txt")).toBeUndefined()
    })

    it("custom scheme", () => {
      expect(extractFilePathFromHref("vscode://extension/id")).toBeUndefined()
    })
  })

  describe("rejects anchors and empty", () => {
    it("pure anchor", () => {
      expect(extractFilePathFromHref("#section")).toBeUndefined()
    })

    it("empty string", () => {
      expect(extractFilePathFromHref("")).toBeUndefined()
    })
  })

  describe("Windows drive letter not treated as scheme", () => {
    it("C: drive path accepted", () => {
      expect(extractFilePathFromHref("C:\\Users\\dev\\file.ts")).toEqual({ path: "C:\\Users\\dev\\file.ts" })
    })

    it("D: drive path with line", () => {
      expect(extractFilePathFromHref("D:\\projects\\app.tsx:10")).toEqual({
        path: "D:\\projects\\app.tsx",
        line: 10,
      })
    })
  })
})
