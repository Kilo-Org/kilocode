import { describe, test, expect } from "bun:test"
import {
  describePatterns,
  resolveLabel,
  TOOL_LABEL_KEYS,
} from "../../webview-ui/src/components/chat/permission-dock-utils"

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
  "ui.permission.toolLabel.bash": "Bash",
  "ui.permission.toolLabel.externalDirectory": "Read External Directory",
  "ui.permission.toolLabel.webFetch": "Web Fetch",
  "ui.permission.toolLabel.codeSearch": "Code Search",
  "ui.permission.toolLabel.todoRead": "Todo Read",
  "ui.permission.toolLabel.todoWrite": "Todo Write",
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
    const expected: Record<string, string> = {
      read: "ui.permission.toolLabel.read",
      edit: "ui.permission.toolLabel.edit",
      write: "ui.permission.toolLabel.write",
      patch: "ui.permission.toolLabel.patch",
      multiedit: "ui.permission.toolLabel.edit",
      glob: "ui.permission.toolLabel.globSearch",
      grep: "ui.permission.toolLabel.grepSearch",
      list: "ui.permission.toolLabel.list",
      bash: "ui.permission.toolLabel.bash",
      external_directory: "ui.permission.toolLabel.externalDirectory",
      webfetch: "ui.permission.toolLabel.webFetch",
      websearch: "ui.permission.toolLabel.webSearch",
      codesearch: "ui.permission.toolLabel.codeSearch",
      todoread: "ui.permission.toolLabel.todoRead",
      todowrite: "ui.permission.toolLabel.todoWrite",
      task: "ui.permission.toolLabel.task",
      skill: "ui.permission.toolLabel.skill",
      lsp: "ui.permission.toolLabel.lsp",
    }
    expect(TOOL_LABEL_KEYS).toEqual(expected)
  })

  test("every i18n key in TOOL_LABEL_KEYS has a mock translation", () => {
    const keys = new Set(Object.values(TOOL_LABEL_KEYS))
    for (const key of keys) {
      expect(labels[key]).toBeDefined()
    }
  })

  test("multi preserves pattern order", () => {
    const result = describePatterns("write", ["z.ts", "a.ts", "m.ts"], t)
    expect(result).toEqual({ kind: "multi", title: "Write:", paths: ["z.ts", "a.ts", "m.ts"] })
  })

  test("grep tool uses Grep Search label", () => {
    const result = describePatterns("grep", ["TODO"], t)
    expect(result).toEqual({ kind: "single", text: "Grep Search TODO" })
  })

  test("list tool uses List label", () => {
    const result = describePatterns("list", ["src/"], t)
    expect(result).toEqual({ kind: "single", text: "List src/" })
  })

  test("webfetch tool uses Web Fetch label", () => {
    const result = describePatterns("webfetch", ["https://example.com"], t)
    expect(result).toEqual({ kind: "single", text: "Web Fetch https://example.com" })
  })

  test("patch tool uses Patch label", () => {
    const result = describePatterns("patch", ["file.ts"], t)
    expect(result).toEqual({ kind: "single", text: "Patch file.ts" })
  })

  test("task tool uses Task label", () => {
    const result = describePatterns("task", ["run-tests"], t)
    expect(result).toEqual({ kind: "single", text: "Task run-tests" })
  })

  test("lsp tool uses LSP label", () => {
    const result = describePatterns("lsp", ["diagnostics"], t)
    expect(result).toEqual({ kind: "single", text: "LSP diagnostics" })
  })
})

describe("resolveLabel", () => {
  test("returns translated label for known tool", () => {
    expect(resolveLabel("read", t)).toBe("Read")
  })

  test("returns translated label for edit", () => {
    expect(resolveLabel("edit", t)).toBe("Edit")
  })

  test("multiedit resolves to Edit", () => {
    expect(resolveLabel("multiedit", t)).toBe("Edit")
  })

  test("returns raw tool name for unknown tool", () => {
    expect(resolveLabel("unknown_tool", t)).toBe("unknown_tool")
  })

  test("returns translated label for all mapped tools", () => {
    const expected: Record<string, string> = {
      read: "Read",
      edit: "Edit",
      write: "Write",
      patch: "Patch",
      multiedit: "Edit",
      glob: "Glob Search",
      grep: "Grep Search",
      list: "List",
      bash: "Bash",
      external_directory: "Read External Directory",
      webfetch: "Web Fetch",
      websearch: "Web Search",
      codesearch: "Code Search",
      todoread: "Todo Read",
      todowrite: "Todo Write",
      task: "Task",
      skill: "Skill",
      lsp: "LSP",
    }
    for (const [tool, label] of Object.entries(expected)) {
      expect(resolveLabel(tool, t)).toBe(label)
    }
  })
})
