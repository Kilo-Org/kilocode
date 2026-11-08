import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "../../src/v1/config/config"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

describe("legacy CLI agent config JSON schema", () => {
  test("exposes code as primary and build as a compatibility alias", () => {
    const document = Schema.toJsonSchemaDocument(ConfigV1.Info)
    const found: Record<string, unknown>[] = []

    function visit(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!isRecord(value)) return
      const props = value.properties
      if (isRecord(props) && "plan" in props && "code" in props && "build" in props) found.push(props)
      Object.values(value).forEach(visit)
    }

    visit(document)
    expect(found).toHaveLength(1)

    const fields = found.at(0)
    if (!fields) throw new Error("Generated config schema has no agent properties")

    const code = fields.code
    const build = fields.build
    if (!isRecord(code) || !isRecord(build)) throw new Error("Generated agents must have full object schemas")
    expect(code.description).toContain("Primary coding agent")
    expect(build.description).toContain("alias for 'code'")

    // Both names expose the same complete AgentConfig schema, so editor
    // completion does not lose configuration keys for either name.
    const shape = (value: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== "description"))
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
