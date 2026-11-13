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

  test.each(["legacy-first", "canonical-first"] as const)(
    "puts code after build when API-decoding both agent names (%s)",
    (order) => {
      const build = { prompt: "Legacy prompt", model: "legacy/model" }
      const code = { prompt: "Canonical prompt", model: "canonical/model" }
      const input = order === "legacy-first" ? { build, code } : { code, build }

      // PATCH /config decodes ConfigV1.Info directly without the file
      // loader's propertyOrder: "original" option. The subsequent
      // preprocessConfig maps build -> code with last-write-wins.
      const cfg = Schema.decodeUnknownSync(ConfigV1.Info)({ agent: input })
      const keys = Object.keys(cfg.agent ?? {})
      const legacy = keys.indexOf("build")
      const canonical = keys.indexOf("code")

      expect(legacy).toBeGreaterThanOrEqual(0)
      expect(canonical).toBeGreaterThan(legacy)
      expect(cfg.agent?.build?.prompt).toBe("Legacy prompt")
      expect(cfg.agent?.code?.prompt).toBe("Canonical prompt")
    },
  )
})
