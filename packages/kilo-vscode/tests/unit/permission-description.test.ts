import { describe, test, expect } from "bun:test"
import { describePatterns, TOOL_LABEL_KEYS } from "../../webview-ui/src/utils/permission-description"

// Mock t() that returns the English label for known keys, or the key itself
const labels: Record<string, string> = {
  "ui.permission.toolLabel.read": "Read",
  "ui.permission.toolLabel.edit": "Edit",
  "ui.permission.toolLabel.write": "Write",
  "ui.permission.toolLabel.patch": "Patch",
  "ui.permission.toolLabel.globSearch": "Glob Search",
  "ui.permission.toolLabel.grepSearch": "Grep Search",
  "ui.permission.toolLabel.webSearch": "Web Search",
  "ui.permission.toolLabel.list": "List",
  "ui.permission.toolLabel.externalDirectory": "Read External Directory",
  "ui.permission.toolLabel.webFetch": "Web Fetch",
  "ui.permission.toolLabel.task": "Task",
  "ui.permission.toolLabel.skill": "Skill",
  "ui.permission.toolLabel.lsp": "LSP",
}
const t = (key: string) => labels[key] ?? key

describe("describePatterns", () => {
  test("returns null when patterns is empty", () => {
    expect(describePatterns("read", [], t)).toBeNull()
  })

  test("returns null when only wildcard pattern", () => {
    expect(describePatterns("read", ["*"], t)).toBeNull()
  })

  test("returns null when multiple wildcards", () => {
    expect(describePatterns("read", ["*", "*"], t)).toBeNull()
  })

  test("single pattern returns single kind with label", () => {
    const result = describePatterns("read", ["src/app.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Read src/app.ts" })
  })

  test("single pattern filters out wildcards", () => {
    const result = describePatterns("edit", ["*", "src/index.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Edit src/index.ts" })
  })

  test("multiple patterns returns multi kind", () => {
    const result = describePatterns("read", ["src/app.ts", "src/index.ts"], t)
    expect(result).toEqual({ kind: "multi", title: "Read:", paths: ["src/app.ts", "src/index.ts"] })
  })

  test("multiple patterns filters out wildcards", () => {
    const result = describePatterns("edit", ["*", "src/a.ts", "src/b.ts"], t)
    expect(result).toEqual({ kind: "multi", title: "Edit:", paths: ["src/a.ts", "src/b.ts"] })
  })

  test("edit tool uses Edit label", () => {
    const result = describePatterns("edit", ["file.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Edit file.ts" })
  })

  test("write tool uses Write label", () => {
    const result = describePatterns("write", ["file.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Write file.ts" })
  })

  test("multiedit tool uses Edit label", () => {
    const result = describePatterns("multiedit", ["file.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Edit file.ts" })
  })

  test("external_directory uses Read External Directory label", () => {
    const result = describePatterns("external_directory", ["/home/user/project/*"], t)
    expect(result).toEqual({ kind: "single", text: "Read External Directory /home/user/project/*" })
  })

  test("glob tool uses Glob Search label", () => {
    const result = describePatterns("glob", ["src/**/*.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Glob Search src/**/*.ts" })
  })

  test("unknown tool uses raw name as label", () => {
    const result = describePatterns("custom_tool", ["some/path"], t)
    expect(result).toEqual({ kind: "single", text: "custom_tool some/path" })
  })

  test("websearch uses Web Search label", () => {
    const result = describePatterns("websearch", ["query"], t)
    expect(result).toEqual({ kind: "single", text: "Web Search query" })
  })

  test("TOOL_LABEL_KEYS maps all expected tools", () => {
    expect(TOOL_LABEL_KEYS.read).toBe("ui.permission.toolLabel.read")
    expect(TOOL_LABEL_KEYS.edit).toBe("ui.permission.toolLabel.edit")
    expect(TOOL_LABEL_KEYS.external_directory).toBe("ui.permission.toolLabel.externalDirectory")
    expect(TOOL_LABEL_KEYS.multiedit).toBe("ui.permission.toolLabel.edit")
  })
})
