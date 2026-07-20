import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("autocomplete provider and model settings", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const props = pkg.contributes.configuration.properties
  const model = props["kilo-code.new.autocomplete.model"]
  const provider = props["kilo-code.new.autocomplete.provider"]

  it("accepts IDs from the normal configured-provider registry", () => {
    expect(provider.type).toBe("string")
    expect(model.type).toBe("string")
    expect(provider.enum).toBeUndefined()
    expect(model.enum).toBeUndefined()
  })

  it("documents the FIM compatibility requirement", () => {
    expect(model.description).toContain("fill-in-the-middle")
  })

  it("does not declare defaults that would strip matching user overrides", () => {
    expect(provider.default).toBeUndefined()
    expect(model.default).toBeUndefined()
  })
})
