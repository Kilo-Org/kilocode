import { describe, expect, it } from "bun:test"
import { isAbsolutePath } from "../../src/path-utils"

describe("isAbsolutePath", () => {
  // ── Unix absolute paths ──────────────────────────────────────────────
  describe("Unix absolute paths", () => {
    it("detects root /", () => {
      expect(isAbsolutePath("/")).toBe(true)
    })

    it("detects simple path", () => {
      expect(isAbsolutePath("/foo/bar")).toBe(true)
    })

    it("detects deep path", () => {
      expect(isAbsolutePath("/Users/marius/Documents/project/src/index.ts")).toBe(true)
    })

    it("detects path with spaces", () => {
      expect(isAbsolutePath("/home/user/my project/file.ts")).toBe(true)
    })

    it("detects path with dots", () => {
      expect(isAbsolutePath("/home/user/../other/./file.ts")).toBe(true)
    })

    it("detects path with special chars", () => {
      expect(isAbsolutePath("/tmp/@scope/pkg/index.js")).toBe(true)
    })
  })

  // ── Windows drive-letter paths ───────────────────────────────────────
  describe("Windows drive-letter paths", () => {
    it("detects uppercase drive with backslash", () => {
      expect(isAbsolutePath("C:\\Users\\marius\\file.ts")).toBe(true)
    })

    it("detects uppercase drive with forward slash", () => {
      expect(isAbsolutePath("C:/Users/marius/file.ts")).toBe(true)
    })

    it("detects lowercase drive letter", () => {
      expect(isAbsolutePath("c:\\users\\file.ts")).toBe(true)
    })

    it("detects various drive letters", () => {
      expect(isAbsolutePath("D:\\data")).toBe(true)
      expect(isAbsolutePath("Z:/files")).toBe(true)
      expect(isAbsolutePath("e:\\temp")).toBe(true)
    })

    it("detects drive root with backslash", () => {
      expect(isAbsolutePath("C:\\")).toBe(true)
    })

    it("detects drive root with forward slash", () => {
      expect(isAbsolutePath("C:/")).toBe(true)
    })

    it("detects mixed separators", () => {
      expect(isAbsolutePath("C:\\Users/marius\\project/file.ts")).toBe(true)
    })
  })

  // ── Windows UNC paths ────────────────────────────────────────────────
  describe("Windows UNC paths", () => {
    it("detects simple UNC path", () => {
      expect(isAbsolutePath("\\\\server\\share")).toBe(true)
    })

    it("detects deeply nested UNC path", () => {
      expect(isAbsolutePath("\\\\server\\share\\folder\\file.ts")).toBe(true)
    })

    it("detects minimal UNC path", () => {
      expect(isAbsolutePath("\\\\ab")).toBe(true)
    })
  })

  // ── Relative paths (should return false) ─────────────────────────────
  describe("relative paths", () => {
    it("rejects bare filename with extension", () => {
      expect(isAbsolutePath("file.ts")).toBe(false)
    })

    it("rejects relative path with directory", () => {
      expect(isAbsolutePath("src/index.ts")).toBe(false)
    })

    it("rejects dot-relative path", () => {
      expect(isAbsolutePath("./foo/bar.ts")).toBe(false)
    })

    it("rejects parent-relative path", () => {
      expect(isAbsolutePath("../foo/bar.ts")).toBe(false)
    })

    it("rejects bare filename without extension", () => {
      expect(isAbsolutePath("Makefile")).toBe(false)
    })

    it("rejects package-style path", () => {
      expect(isAbsolutePath("@scope/package/index.js")).toBe(false)
    })
  })

  // ── Edge cases ───────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("rejects empty string", () => {
      expect(isAbsolutePath("")).toBe(false)
    })

    it("rejects URL with protocol", () => {
      expect(isAbsolutePath("https://example.com/path")).toBe(false)
      expect(isAbsolutePath("http://localhost:3000")).toBe(false)
    })

    it("rejects file:// URL", () => {
      expect(isAbsolutePath("file:///foo/bar")).toBe(false)
    })

    it("rejects drive-relative path (C:file without separator)", () => {
      // C:file is a Windows drive-relative path, not absolute
      expect(isAbsolutePath("C:file.ts")).toBe(false)
    })

    it("rejects bare drive letter with colon only", () => {
      expect(isAbsolutePath("C:")).toBe(false)
    })

    it("rejects single backslash (not UNC)", () => {
      expect(isAbsolutePath("\\foo")).toBe(false)
    })

    it("rejects number-prefixed colon paths", () => {
      expect(isAbsolutePath("1:\\foo")).toBe(false)
    })

    it("rejects symbol-prefixed colon paths", () => {
      expect(isAbsolutePath("@:\\foo")).toBe(false)
    })

    it("rejects tilde home path", () => {
      expect(isAbsolutePath("~/Documents/file.ts")).toBe(false)
    })

    it("treats /C:/foo as absolute (Unix-style prefix)", () => {
      // Starts with / so it's Unix-absolute regardless of Windows-like suffix
      expect(isAbsolutePath("/C:/Users/foo")).toBe(true)
    })

    it("rejects whitespace-only strings", () => {
      expect(isAbsolutePath(" ")).toBe(false)
      expect(isAbsolutePath("  ")).toBe(false)
    })

    it("rejects path starting with dot-dot alone", () => {
      expect(isAbsolutePath("..")).toBe(false)
    })

    it("rejects path starting with single dot", () => {
      expect(isAbsolutePath(".")).toBe(false)
    })
  })
})
