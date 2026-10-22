import { describe, expect, test } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"

describe("kilocode filesystem containment", () => {
  test("keeps dot-prefixed child names internal", () => {
    expect(FSUtil.contains("/a/b", "/a/b/..cache/file")).toBe(true)
  })

  test("rejects cross-drive paths on Windows", () => {
    if (process.platform !== "win32") return
    expect(FSUtil.contains("C:\\repo", "D:\\outside\\file.txt")).toBe(false)
  })
})
