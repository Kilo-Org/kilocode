import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AUTOCOMPLETE_MODELS } from "../../src/shared/autocomplete-models"

describe("autocomplete model enum ↔ AUTOCOMPLETE_MODELS sync", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const prop = pkg.contributes.configuration.properties["kilo-code.new.autocomplete.model"]

  it("package.json enum matches AUTOCOMPLETE_MODELS ids", () => {
    const ids = AUTOCOMPLETE_MODELS.map((m) => m.id)
    expect(prop.enum).toEqual(ids)
  })

  it("package.json enumDescriptions has one entry per model", () => {
    expect(prop.enumDescriptions).toHaveLength(AUTOCOMPLETE_MODELS.length)
  })

  it("package.json does not declare a default (VS Code strips user overrides that equal the schema default)", () => {
    expect(prop.default).toBeUndefined()
  })
})
