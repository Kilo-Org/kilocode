import { describe, expect, test } from "bun:test"
import {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AUTOCOMPLETE_PROVIDER_ID,
} from "../src/autocomplete"

describe("DEFAULT_AUTOCOMPLETE_MODEL", () => {
  test("resolves to an entry that exists in AUTOCOMPLETE_MODELS", () => {
    const match = AUTOCOMPLETE_MODELS.find(
      (m) => m.providerID === DEFAULT_AUTOCOMPLETE_PROVIDER_ID && m.modelID === DEFAULT_AUTOCOMPLETE_MODEL_ID,
    )
    expect(match).toBeDefined()
    expect(DEFAULT_AUTOCOMPLETE_MODEL).toBe(match!)
  })
})
