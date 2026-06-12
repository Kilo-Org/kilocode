import { describe, expect, test } from "bun:test"
import { resolveKiloCredentials } from "../../../src/kilocode/auth/credentials"

describe("Kilo credential precedence", () => {
  test("environment overrides config, stored auth, and provider state", () => {
    const result = resolveKiloCredentials({
      env: { KILO_API_KEY: " env-token ", KILO_ORG_ID: " env-org " },
      config: {
        provider: {
          kilo: { options: { apiKey: "config-token", kilocodeOrganizationId: "config-org" } },
        },
      },
      auth: { type: "oauth", access: "stored-token", accountId: "stored-org" },
      provider: {
        key: "provider-key",
        options: { kilocodeToken: "provider-token", kilocodeOrganizationId: "provider-org" },
      },
      token: "feature-token",
      organizationId: "feature-org",
    })

    expect(result).toEqual({ token: "env-token", organizationId: "env-org", baseUrl: undefined })
  })

  test("resolves token and organization independently", () => {
    expect(
      resolveKiloCredentials({
        env: { KILO_ORG_ID: "env-org" },
        config: { provider: { kilo: { options: { apiKey: "config-token" } } } },
        auth: { type: "oauth", access: "stored-token", accountId: "stored-org" },
      }),
    ).toEqual({ token: "config-token", organizationId: "env-org", baseUrl: undefined })
  })

  test("effective provider config overrides feature-specific fallbacks", () => {
    expect(
      resolveKiloCredentials({
        env: {},
        config: {
          provider: {
            kilo: { options: { apiKey: "effective-token", kilocodeOrganizationId: "effective-org" } },
          },
        },
        token: "feature-token",
        organizationId: "feature-org",
      }),
    ).toMatchObject({ token: "effective-token", organizationId: "effective-org" })
  })

  test("falls back through API, OAuth, and well-known auth", () => {
    expect(resolveKiloCredentials({ env: {}, auth: { type: "api", key: "api-token" } }).token).toBe("api-token")
    expect(
      resolveKiloCredentials({ env: {}, auth: { type: "oauth", access: "oauth-token", accountId: "oauth-org" } }),
    ).toMatchObject({ token: "oauth-token", organizationId: "oauth-org" })
    expect(resolveKiloCredentials({ env: {}, auth: { type: "wellknown", token: "wellknown-token" } }).token).toBe(
      "wellknown-token",
    )
  })

  test("ignores empty environment values", () => {
    expect(
      resolveKiloCredentials({
        env: { KILO_API_KEY: " ", KILO_ORG_ID: "" },
        auth: { type: "oauth", access: "stored-token", accountId: "stored-org" },
      }),
    ).toMatchObject({ token: "stored-token", organizationId: "stored-org" })
  })
})
