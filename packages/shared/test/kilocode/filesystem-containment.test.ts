import { describe, expect, test } from "bun:test"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

describe("kilocode filesystem containment", () => {
  test("keeps dot-prefixed child names internal", () => {
    expect(AppFileSystem.contains("/a/b", "/a/b/..cache/file")).toBe(true)
  })

  test("rejects cross-drive paths on Windows", () => {
    if (process.platform !== "win32") return
    expect(AppFileSystem.contains("C:\\repo", "D:\\outside\\file.txt")).toBe(false)
  })
})
