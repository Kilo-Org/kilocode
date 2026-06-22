import { describe, expect, test } from "bun:test"
import {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AUTOCOMPLETE_PROVIDER_ID,
} from "../src/autocomplete"

describe("DEFAULT_AUTOCOMPLETE_MODEL", () => {
  test("resolves to Mercury Next Edit through Kilo Gateway", () => {
    const match = AUTOCOMPLETE_MODELS.find(
      (m) => m.providerID === DEFAULT_AUTOCOMPLETE_PROVIDER_ID && m.modelID === DEFAULT_AUTOCOMPLETE_MODEL_ID,
    )
    expect(DEFAULT_AUTOCOMPLETE_PROVIDER_ID).toBe("kilo")
    expect(DEFAULT_AUTOCOMPLETE_MODEL_ID).toBe("inception/mercury-next-edit")
    expect(match).toBeDefined()
    expect(DEFAULT_AUTOCOMPLETE_MODEL).toBe(match!)
    expect(DEFAULT_AUTOCOMPLETE_MODEL.kind).toBe("edit")
  })
})
