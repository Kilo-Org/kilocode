import { describe, it, expect } from "bun:test"
import { TeamExportEnvelope } from "@/devilcode/team/export-envelope"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

function makeBase(): Record<string, unknown> {
  const team = loadQuickstartTemplates()["solo-enhanced"].team
  return {
    version: "1.0.0",
    checksum: "a".repeat(64),
    config: team,
    exportedAt: new Date().toISOString(),
  }
}

describe("TeamExportEnvelope", () => {
  it("accepts a valid envelope", () => {
    const parsed = TeamExportEnvelope.parse(makeBase())
    expect(parsed.version).toBe("1.0.0")
    expect(parsed.exportedBy).toBeUndefined()
  })

  it("accepts optional exportedBy", () => {
    const parsed = TeamExportEnvelope.parse({ ...makeBase(), exportedBy: "user@example.com" })
    expect(parsed.exportedBy).toBe("user@example.com")
  })

  it("rejects missing version", () => {
    const { version, ...rest } = makeBase()
    void version
    expect(() => TeamExportEnvelope.parse(rest)).toThrow()
  })

  it("rejects wrong version literal", () => {
    expect(() => TeamExportEnvelope.parse({ ...makeBase(), version: "2.0.0" })).toThrow()
  })

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => TeamExportEnvelope.parse({ ...makeBase(), foo: "bar" })).toThrow()
  })

  it("rejects non-hex checksum via regex", () => {
    expect(() => TeamExportEnvelope.parse({ ...makeBase(), checksum: "not-hex" })).toThrow()
    expect(() => TeamExportEnvelope.parse({ ...makeBase(), checksum: "A".repeat(64) })).toThrow()
    expect(() => TeamExportEnvelope.parse({ ...makeBase(), checksum: "a".repeat(63) })).toThrow()
  })

  it("rejects non-ISO exportedAt", () => {
    expect(() => TeamExportEnvelope.parse({ ...makeBase(), exportedAt: "yesterday" })).toThrow()
  })

  it("rejects when nested config invalid", () => {
    const base = makeBase()
    const badConfig = { ...(base.config as Record<string, unknown>), roles: "oops" }
    expect(() => TeamExportEnvelope.parse({ ...base, config: badConfig })).toThrow()
  })
})
