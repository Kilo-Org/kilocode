import { describe, expect, it } from "bun:test"
import { fieldID } from "../../webview-ui/src/components/stack/resource-id"

describe("Stack resource field IDs", () => {
  it("keeps shared resource fields, labels, and errors unique per technology occurrence", () => {
    const ids = ["dbt", "warehouse"].flatMap((technology) => {
      const method = fieldID(technology, "mcp:shared", "method")
      const parameter = fieldID(technology, "mcp:shared", "parameter-url")
      return [method, `${method}-label`, `${method}-error`, parameter, `${parameter}-label`, `${parameter}-error`]
    })

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.includes("mcp_3a_shared"))).toBe(true)
    expect(fieldID("dbt", "mcp:a-b", "method")).not.toBe(fieldID("dbt", "mcp:a:b", "method"))
  })
})
