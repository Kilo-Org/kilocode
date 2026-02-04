// kilocode_change - new file

import { normalizeKiloOpenRouterURL } from "@kilocode/kilo-gateway"

describe("normalizeKiloOpenRouterURL", () => {
  test("flattens /api/organizations/<id>/openrouter to /api/openrouter", () => {
    const result = normalizeKiloOpenRouterURL({
      baseURL: "https://api.kilo.ai/api/organizations/org_a/openrouter",
      kilocodeOrganizationId: "org_b",
    })
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter/")
    expect(result.kilocodeOrganizationId).toBe("org_b")
  })

  test("converts /api/openrouter to /api/organizations/<id>/openrouter when org is provided", () => {
    const result = normalizeKiloOpenRouterURL({
      baseURL: "https://api.kilo.ai/api/openrouter",
      kilocodeOrganizationId: "org_123",
    })
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter/")
    expect(result.kilocodeOrganizationId).toBe("org_123")
  })

  test("flattens /api/organizations/<id> to /api/openrouter", () => {
    const result = normalizeKiloOpenRouterURL({
      baseURL: "https://api.kilo.ai/api/organizations/org_a",
    })
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter/")
    expect(result.kilocodeOrganizationId).toBeUndefined()
  })

  test("defaults to /api/openrouter when no org info exists", () => {
    const result = normalizeKiloOpenRouterURL({
      baseURL: "https://api.kilo.ai",
    })
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter/")
    expect(result.kilocodeOrganizationId).toBeUndefined()
  })
})
