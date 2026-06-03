import { afterEach, describe, expect, test } from "bun:test"
import { getApiKey, getKiloOrganizationId } from "../src/auth/token"
import { buildRequestHeaders } from "../src/provider"
import { getOrganizationId, getToken, setOrganization, UnauthorizedError } from "../src/server/handlers"

const key = process.env.KILO_API_KEY
const org = process.env.KILO_ORG_ID

afterEach(() => {
  if (key === undefined) delete process.env.KILO_API_KEY
  else process.env.KILO_API_KEY = key
  if (org === undefined) delete process.env.KILO_ORG_ID
  else process.env.KILO_ORG_ID = org
})

describe("Kilo provider request headers", () => {
  test("request headers override provider defaults", () => {
    const headers = buildRequestHeaders(
      {
        "content-type": "application/json",
        "x-kilocode-feature": "vscode-extension",
        "x-default-only": "kept",
      },
      {
        "x-kilocode-feature": "agent-manager",
        "x-request-only": "kept-too",
      },
    )

    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("x-kilocode-feature")).toBe("agent-manager")
    expect(headers.get("x-default-only")).toBe("kept")
    expect(headers.get("x-request-only")).toBe("kept-too")
  })
})

describe("Kilo provider environment overrides", () => {
  test("prefers KILO_API_KEY over stored and configured tokens", () => {
    expect(
      getApiKey({
        env: { KILO_API_KEY: " env-token " },
        kilocodeToken: "stored-token",
        apiKey: "config-token",
      }),
    ).toBe("env-token")
  })

  test("ignores an empty KILO_API_KEY override", () => {
    expect(getApiKey({ env: { KILO_API_KEY: " " }, kilocodeToken: "stored-token" })).toBe("stored-token")
  })

  test("prefers KILO_ORG_ID over the stored organization", () => {
    expect(
      getKiloOrganizationId({ env: { KILO_ORG_ID: " org-env " }, kilocodeOrganizationId: "org-stored" }),
    ).toBe("org-env")
  })
})

describe("Kilo server environment overrides", () => {
  test("prefers environment overrides over stored auth", () => {
    process.env.KILO_API_KEY = " env-token "
    process.env.KILO_ORG_ID = " org-env "

    expect(getToken({ type: "api", key: "stored-token" })).toBe("env-token")
    expect(getOrganizationId({ type: "oauth", access: "stored-token", refresh: "refresh", expires: 1, accountId: "org-stored" })).toBe(
      "org-env",
    )
  })

  test("keeps saved organization mutation OAuth-only", async () => {
    process.env.KILO_API_KEY = "env-token"
    await expect(
      setOrganization(
        {
          auth: {
            get: async () => undefined,
            set: async () => undefined,
          },
          clear: () => undefined,
          dispose: async () => undefined,
        },
        "org-env",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
