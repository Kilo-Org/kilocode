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
    const code = fields?.code as Record<string, unknown> | undefined
    const build = fields?.build as Record<string, unknown> | undefined
    expect(code?.description).toContain("Primary coding agent")
    expect(build?.description).toContain("alias for 'code'")

    // Both agent names expose the same full AgentConfig schema, not a
    // reduced subset of properties that breaks editor completion.
    const shape = (value: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => key !== "description"))
    expect(code).toBeDefined()
    expect(build).toBeDefined()
    expect(shape(code)).toEqual(shape(build))
  })

  test.each(["code", "build"] as const)("accepts %s config without dropping agent options", (name) => {
    const cfg = Schema.decodeUnknownSync(ConfigV1.Info)({
      agent: {
        [name]: { prompt: "Use this agent", mode: "primary", temperature: 0.4 },
      },
    })

    expect(cfg.agent?.[name]?.prompt).toBe("Use this agent")
    expect(cfg.agent?.[name]?.mode).toBe("primary")
    expect(cfg.agent?.[name]?.temperature).toBe(0.4)
  })
})
