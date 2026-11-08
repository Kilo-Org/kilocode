import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "../../src/v1/config/config"

describe("legacy CLI agent config JSON schema", () => {
  test("exposes code as primary and build as a compatibility alias", () => {
    const document = Schema.toJsonSchemaDocument(ConfigV1.Info)
    const found: Record<string, unknown>[] = []

    function visit(value: unknown): void {
      if (value === null || typeof value !== "object") return
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      const object = value as Record<string, unknown>
      const properties = object.properties
      if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        const fields = properties as Record<string, unknown>
        if ("plan" in fields && "code" in fields && "build" in fields) found.push(fields)
      }
      Object.values(object).forEach(visit)
    }

    visit(document)
    expect(found).toHaveLength(1)

    const fields = found.at(0)
    expect(fields).toBeDefined()
    const code = fields?.code as { description?: string } | undefined
    const build = fields?.build as { description?: string } | undefined
    expect(code?.description).toContain("Primary coding agent")
    expect(build?.description).toContain("alias for 'code'")
  })
})
