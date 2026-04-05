import { describe, it, expect } from "bun:test"
import { convertToMentionPath, extractDropPaths } from "../../webview-ui/src/utils/path-mentions"

describe("convertToMentionPath", () => {
  it("converts an absolute path under cwd to a relative path", () => {
    expect(convertToMentionPath("/home/user/project/src/index.ts", "/home/user/project")).toBe("src/index.ts")
  })

  it("strips file:// protocol", () => {
    expect(convertToMentionPath("file:///home/user/project/lib/util.ts", "/home/user/project")).toBe("lib/util.ts")
  })

  it("strips vscode-remote:// protocol", () => {
    expect(convertToMentionPath("vscode-remote://ssh-remote+host/home/user/project/app.ts", "/home/user/project")).toBe(
      "app.ts",
    )
  })

  it("decodes URI-encoded characters", () => {
    expect(convertToMentionPath("file:///home/user/my%20project/file.ts", "/home/user/my project")).toBe("file.ts")
  })

  it("preserves spaces in relative paths (no escaping)", () => {
    expect(convertToMentionPath("/workspace/my folder/file.ts", "/workspace")).toBe("my folder/file.ts")
  })

  it("does not match cwd prefix without boundary", () => {
    expect(convertToMentionPath("/workspace/app2/file.ts", "/workspace/app")).toBe("/workspace/app2/file.ts")
  })

  it("handles Windows file:// paths with leading slash", () => {
    expect(convertToMentionPath("file:///D:/Projects/app/src/main.ts", "D:\\Projects\\app")).toBe("src/main.ts")
  })

  it("handles Windows backslash cwd", () => {
    expect(convertToMentionPath("D:\\Projects\\app\\src\\main.ts", "D:\\Projects\\app")).toBe("src/main.ts")
  })

  it("uses case-insensitive comparison for matching", () => {
    expect(convertToMentionPath("D:/projects/App/src/main.ts", "D:/Projects/app")).toBe("src/main.ts")
  })

  it("returns raw path when outside cwd", () => {
    expect(convertToMentionPath("/other/dir/file.ts", "/home/user/project")).toBe("/other/dir/file.ts")
  })

  it("returns cleaned path when cwd is empty", () => {
    expect(convertToMentionPath("/some/file.ts", "")).toBe("/some/file.ts")
  })

  it("handles trailing slash on cwd", () => {
    expect(convertToMentionPath("/workspace/src/index.ts", "/workspace/")).toBe("src/index.ts")
  })

  it("does not include @ prefix (callers add it)", () => {
    const result = convertToMentionPath("/workspace/src/app.ts", "/workspace")
    expect(result).toBe("src/app.ts")
    expect(result.startsWith("@")).toBe(false)
  })
})

describe("extractDropPaths", () => {
  it("returns null when no text or URI data is present", () => {
    const dt = { getData: () => "" } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toBe(null)
  })

  it("extracts paths from application/vnd.code.uri-list", () => {
    const dt = {
      getData: (type: string) => (type === "application/vnd.code.uri-list" ? "file:///home/user/a.ts" : ""),
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toEqual(["file:///home/user/a.ts"])
  })

  it("prefers uri-list over text/plain", () => {
    const dt = {
      getData: (type: string) => {
        if (type === "application/vnd.code.uri-list") return "file:///from-uri.ts"
        if (type === "text") return "/from-text.ts"
        return ""
      },
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toEqual(["file:///from-uri.ts"])
  })

  it("falls back to text/plain when lines are file paths", () => {
    const dt = {
      getData: (type: string) => (type === "text" ? "/home/user/file.ts" : ""),
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toEqual(["/home/user/file.ts"])
  })

  it("accepts Windows absolute paths from text/plain", () => {
    const dt = {
      getData: (type: string) => (type === "text" ? "C:\\Users\\me\\file.ts" : ""),
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toEqual(["C:\\Users\\me\\file.ts"])
  })

  it("rejects plain text that is not a file path", () => {
    const dt = {
      getData: (type: string) => (type === "text" ? "hello world" : ""),
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toBe(null)
  })

  it("rejects mixed text with non-path lines", () => {
    const dt = {
      getData: (type: string) => (type === "text" ? "/valid/path.ts\nnot a path" : ""),
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toBe(null)
  })

  it("splits multiple paths on newlines from uri-list", () => {
    const dt = {
      getData: (type: string) =>
        type === "application/vnd.code.uri-list"
          ? "file:///home/user/a.ts\nfile:///home/user/b.ts\r\nfile:///home/user/c.ts"
          : "",
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toEqual(["file:///home/user/a.ts", "file:///home/user/b.ts", "file:///home/user/c.ts"])
  })

  it("filters out empty lines", () => {
    const dt = {
      getData: (type: string) => (type === "application/vnd.code.uri-list" ? "file:///a.ts\n\n  \nfile:///b.ts" : ""),
    } as unknown as DataTransfer
    expect(extractDropPaths(dt)).toEqual(["file:///a.ts", "file:///b.ts"])
  })
})
