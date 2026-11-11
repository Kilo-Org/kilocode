import { describe, expect, test } from "bun:test"
import type { PermissionRequest, PermissionSavedInfo } from "@opencode/client"
import { displayResource, widenSaved, widerRule } from "../webview-ui/src/v2/permission-rules"

const request = (input: Partial<PermissionRequest>): PermissionRequest => ({
  id: "per_browser",
  sessionID: "ses_browser",
  action: "browser_open",
  resources: ["navigate:http://localhost:3000"],
  save: ["navigate:http://localhost:3000"],
  metadata: { rules: ["navigate:http://localhost:3000", "navigate:*"] },
  ...input,
})

/** An in-memory saved-permission table with the server's unique (project, action, resource) rule. */
function table(rows: Array<Pick<PermissionSavedInfo, "action" | "resource">>, projectID = "prj_a") {
  const saved = rows.map(
    (row, index) =>
      ({
        id: `psv_${index}`,
        projectID,
        ...row,
        time: { created: 0, updated: 0 },
      }) as PermissionSavedInfo,
  )
  return {
    saved,
    async list(input?: { projectID?: string }) {
      return saved.filter((row) => !input?.projectID || row.projectID === input.projectID)
    },
    async update(input: { id: string; resource?: string }) {
      const row = saved.find((item) => item.id === input.id)!
      if (saved.some((item) => item !== row && item.action === row.action && item.resource === input.resource))
        throw new Error("conflict")
      Object.assign(row, { resource: input.resource })
      return row
    },
  }
}

describe("browser_open permission display", () => {
  test("hides the navigate: prefix", () => {
    expect(displayResource("browser_open", "navigate:http://localhost:3000")).toBe("http://localhost:3000")
    expect(displayResource("browser_open", "navigate:*")).toBe("*")
  })

  test("keeps other resources as they are", () => {
    expect(displayResource("shell", "navigate:foo")).toBe("navigate:foo")
    expect(displayResource("browser_open", "*")).toBe("*")
  })
})

describe("browser_open broader rule", () => {
  test("offers the rule metadata lists beyond the saved origin", () => {
    expect(widerRule(request({}))).toBe("navigate:*")
  })

  test("offers nothing without metadata rules or for another tool", () => {
    expect(widerRule(request({ metadata: undefined }))).toBeUndefined()
    expect(widerRule(request({ action: "webfetch" }))).toBeUndefined()
    expect(widerRule(request({ metadata: { rules: ["navigate:http://localhost:3000"] } }))).toBeUndefined()
  })
})

describe("widening a saved origin approval", () => {
  const input = { projectID: "prj_a", action: "browser_open", from: "navigate:http://localhost:3000", to: "navigate:*" }

  test("rewrites the saved origin rule to every site", async () => {
    const saved = table([{ action: "browser_open", resource: input.from }])
    await widenSaved(saved, input)
    expect(saved.saved.map((row) => row.resource)).toEqual(["navigate:*"])
  })

  test("leaves the project alone when it already allows every site", async () => {
    const saved = table([
      { action: "browser_open", resource: "navigate:*" },
      { action: "browser_open", resource: input.from },
    ])
    await widenSaved(saved, input)
    expect(saved.saved.map((row) => row.resource)).toEqual(["navigate:*", input.from])
  })

  test("does not touch another project's approval", async () => {
    const saved = table([{ action: "browser_open", resource: input.from }], "prj_b")
    await widenSaved(saved, input)
    expect(saved.saved.map((row) => row.resource)).toEqual([input.from])
  })
})
