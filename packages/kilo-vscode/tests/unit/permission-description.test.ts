import { describe, test, expect } from "bun:test"
import { describePatterns } from "../../webview-ui/src/utils/permission-description"

describe("describePatterns", () => {
  test("returns null when patterns is empty", () => {
    expect(describePatterns("read", [])).toBeNull()
  })

  test("returns null when only wildcard pattern", () => {
    expect(describePatterns("read", ["*"])).toBeNull()
  })

  test("returns null when multiple wildcards", () => {
    expect(describePatterns("read", ["*", "*"])).toBeNull()
  })

  test("single pattern returns single kind with label", () => {
    const result = describePatterns("read", ["src/app.ts"])
    expect(result).toEqual({ kind: "single", text: "Read src/app.ts" })
  })

  test("single pattern filters out wildcards", () => {
    const result = describePatterns("edit", ["*", "src/index.ts"])
    expect(result).toEqual({ kind: "single", text: "Edit src/index.ts" })
  })

  test("multiple patterns returns multi kind", () => {
    const result = describePatterns("read", ["src/app.ts", "src/index.ts"])
    expect(result).toEqual({ kind: "multi", title: "Read:", paths: ["src/app.ts", "src/index.ts"] })
  })

  test("multiple patterns filters out wildcards", () => {
    const result = describePatterns("edit", ["*", "src/a.ts", "src/b.ts"])
    expect(result).toEqual({ kind: "multi", title: "Edit:", paths: ["src/a.ts", "src/b.ts"] })
  })

  test("edit tool uses Edit label", () => {
    const result = describePatterns("edit", ["file.ts"])
    expect(result).toEqual({ kind: "single", text: "Edit file.ts" })
  })

  test("write tool uses Write label", () => {
    const result = describePatterns("write", ["file.ts"])
    expect(result).toEqual({ kind: "single", text: "Write file.ts" })
  })

  test("multiedit tool uses Edit label", () => {
    const result = describePatterns("multiedit", ["file.ts"])
    expect(result).toEqual({ kind: "single", text: "Edit file.ts" })
  })

  test("external_directory uses External Directory label", () => {
    const result = describePatterns("external_directory", ["/home/user/project/*"])
    expect(result).toEqual({ kind: "single", text: "External Directory /home/user/project/*" })
  })

  test("glob tool uses Search label", () => {
    const result = describePatterns("glob", ["src/**/*.ts"])
    expect(result).toEqual({ kind: "single", text: "Search src/**/*.ts" })
  })

  test("unknown tool uses raw name as label", () => {
    const result = describePatterns("custom_tool", ["some/path"])
    expect(result).toEqual({ kind: "single", text: "custom_tool some/path" })
  })

  test("websearch uses Search label", () => {
    const result = describePatterns("websearch", ["query"])
    expect(result).toEqual({ kind: "single", text: "Search query" })
  })
})
