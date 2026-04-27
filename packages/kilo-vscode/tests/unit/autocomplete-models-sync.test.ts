import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AUTOCOMPLETE_MODELS, DEFAULT_AUTOCOMPLETE_MODEL } from "../../src/shared/autocomplete-models"

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

  it("package.json default matches DEFAULT_AUTOCOMPLETE_MODEL", () => {
    expect(prop.default).toBe(DEFAULT_AUTOCOMPLETE_MODEL.id)
  })
})
