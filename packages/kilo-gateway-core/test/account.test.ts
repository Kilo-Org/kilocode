import { expect, test } from "bun:test"
import { KiloAccount, KiloHeaders, KiloServer } from "../src/index.js"

test("normalizes the server and resolves KILO_API_URL and KILO_AI_GATEWAY_URL like main", () => {
  expect(KiloServer.fromEnv({})).toBe("https://api.kilo.ai")
  expect(KiloServer.fromEnv({ KILO_API_URL: "http://localhost:3000/" })).toBe("http://localhost:3000")
  expect(KiloServer.normalize("https://example.test/prefix//?query#hash")).toBe("https://example.test/prefix")
  expect(() => KiloServer.normalize("ftp://example.test")).toThrow("Invalid Kilo API URL")
  expect(() => KiloServer.fromEnv({ KILO_API_URL: "not a url" })).toThrow("Invalid Kilo API URL")
  expect(KiloServer.aiGatewayFromEnv({})).toBe("https://ai-gateway.kilo.ai/api/v1")
  expect(KiloServer.aiGatewayFromEnv({ KILO_API_URL: "http://localhost:3000/" })).toBe(
    "http://localhost:3000/api/gateway/v1",
  )
  expect(
    KiloServer.aiGatewayFromEnv({
      KILO_API_URL: "http://localhost:3000",
      KILO_AI_GATEWAY_URL: "http://localhost:3001/api/v1/",
    }),
  ).toBe("http://localhost:3001/api/v1")
  expect(KiloServer.gateway("https://api.kilo.ai", {})).toBe("https://ai-gateway.kilo.ai/api/v1")
  expect(KiloServer.gateway("http://localhost:3000", { KILO_API_URL: "http://localhost:3000" })).toBe(
    "http://localhost:3000/api/gateway/v1",
  )
  const env = {
    KILO_API_URL: "https://api.example.test",
    KILO_AI_GATEWAY_URL: "https://gateway.example.test/api/v1/",
  }
  expect(KiloServer.gateway("https://api.example.test", env)).toBe("https://gateway.example.test/api/v1")
  expect(KiloServer.gateway("https://gateway.example.test/api/v1", env)).toBe("https://gateway.example.test/api/v1")
  expect(KiloServer.gateway("https://staging.kilo.test", {})).toBe("https://staging.kilo.test/api/gateway")
  expect(KiloServer.openrouter("https://api.example.test", env)).toBe("https://gateway.example.test/api/v1")
  expect(KiloServer.openrouter("https://staging.kilo.test", {})).toBe("https://staging.kilo.test/api/openrouter")
  // v1 url.test.ts: an existing `/api/...` route is replaced, a path prefix is kept, and search and hash are dropped.
  expect(KiloServer.openrouter("https://staging.kilo.test/api/openrouter", {})).toBe(
    "https://staging.kilo.test/api/openrouter",
  )
  expect(KiloServer.openrouter("https://staging.kilo.test/proxy/api/organizations/team/", env)).toBe(
    "https://staging.kilo.test/proxy/api/openrouter",
  )
  expect(KiloServer.apiUrl("https://staging.kilo.test/proxy?x=1#y", "gateway")).toBe(
    "https://staging.kilo.test/proxy/api/gateway",
  )
})

test("reads the server from a token like v1", () => {
  expect(KiloServer.fromToken("http://localhost:3000:secret")).toBe("http://localhost:3000")
  expect(KiloServer.fromToken("http://localhost:3000:1234")).toBe("http://localhost:3000")
  expect(KiloServer.fromToken("http://localhost:3000:abc:def")).toBe("http://localhost:3000")
  expect(KiloServer.fromToken("https://staging.example.test/base:secret")).toBe("https://staging.example.test/base")
  expect(KiloServer.fromToken("https://staging.example.test/base:123")).toBe("https://staging.example.test/base")
  expect(KiloServer.fromToken("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toBeUndefined()
})

test("reads only direct environment tokens in v1 and cloud-consumer order", () => {
  expect(KiloAccount.envToken({})).toBeUndefined()
  expect(KiloAccount.envToken({ KILO_API_KEY: "api-key", KILOCODE_TOKEN: "cloud-token" })).toEqual({
    token: "api-key",
  })
  expect(
    KiloAccount.envToken({
      KILO_API_KEY: "",
      KILOCODE_TOKEN: "cloud-token",
      KILO_AUTH_CONTENT: JSON.stringify({ kilo: { key: "content-token" } }),
    }),
  ).toEqual({ token: "cloud-token" })
  expect(
    KiloAccount.envToken({
      KILO_AUTH_CONTENT: JSON.stringify({ kilo: { access: "content-token", accountId: "content-team" } }),
    }),
  ).toBeUndefined()
})

test("distinguishes no auth-content override from a replacement store without a Kilo credential", () => {
  expect(KiloAccount.authContent({})).toBeUndefined()
  expect(KiloAccount.authContent({ KILO_AUTH_CONTENT: "not json" })).toBeUndefined()
  expect(KiloAccount.authContent({ KILO_AUTH_CONTENT: JSON.stringify({ kilo: { key: 42 } }) })).toBeUndefined()
  expect(KiloAccount.authContent({ KILO_AUTH_CONTENT: "{}" })).toBeNull()
  expect(KiloAccount.authContent({ KILO_AUTH_CONTENT: JSON.stringify({ other: { key: "other-token" } }) })).toBeNull()
  expect(KiloAccount.authContent({ KILO_AUTH_CONTENT: JSON.stringify({ kilo: { key: "", access: "" } }) })).toEqual({
    token: "",
  })
})

test("reads API and OAuth auth content with team or explicit personal selection", () => {
  expect(
    KiloAccount.authContent({
      KILO_AUTH_CONTENT: JSON.stringify({ kilo: { key: "api-key", access: "oauth-token", accountId: "team" } }),
    }),
  ).toEqual({ token: "api-key", organizationID: "team" })
  expect(KiloAccount.authContent({ KILO_AUTH_CONTENT: JSON.stringify({ kilo: { access: "oauth-token" } }) })).toEqual({
    token: "oauth-token",
  })
  expect(
    KiloAccount.authContent({
      KILO_AUTH_CONTENT: JSON.stringify({ kilo: { type: "oauth", key: "", access: "oauth-token", accountId: null } }),
    }),
  ).toEqual({ token: "oauth-token", organizationID: null })
})

test("resolves the account server and team in v1 order", () => {
  expect(KiloAccount.resolve({ token: "plain" }, {})).toEqual({
    token: "plain",
    server: "https://api.kilo.ai",
    organizationID: null,
  })
  expect(
    KiloAccount.resolve(
      { token: "plain", server: "https://login.example.test/", organizationID: "team" },
      {
        KILO_API_URL: "https://env.example.test",
      },
    ),
  ).toEqual({ token: "plain", server: "https://login.example.test", organizationID: "team" })
  expect(
    KiloAccount.resolve(
      { token: "http://localhost:3000:secret", server: "https://login.example.test", organizationID: "saved-team" },
      { KILO_API_URL: "https://env.example.test", KILO_ORG_ID: "env-team" },
    ),
  ).toEqual({ token: "http://localhost:3000:secret", server: "http://localhost:3000", organizationID: "env-team" })
  expect(KiloAccount.resolve({ token: "https://gateway.test/api/organizations/token-org:secret" }, {})).toEqual({
    token: "https://gateway.test/api/organizations/token-org:secret",
    server: "https://gateway.test/api/organizations/token-org",
    organizationID: "token-org",
  })
})

test("keeps explicit organization selections and rejects conflicts with a scoped token server", () => {
  const token = "https://gateway.test/api/organizations/token-org:secret"
  const same = KiloAccount.resolve({ token, organizationID: "token-org" }, {})
  expect(KiloAccount.compatible(same)).toBe(true)
  expect(KiloServer.openrouter(same.server, {})).toBe("https://gateway.test/api/openrouter")
  const different = KiloAccount.resolve({ token, organizationID: "selected-org" }, {})
  expect(different.organizationID).toBe("selected-org")
  expect(KiloAccount.compatible(different)).toBe(false)
  const personal = KiloAccount.resolve({ token, organizationID: null }, {})
  expect(personal.organizationID).toBeNull()
  expect(KiloAccount.compatible(personal)).toBe(false)
  const override = KiloAccount.resolve({ token, organizationID: "token-org" }, { KILO_ORG_ID: "env-org" })
  expect(override.organizationID).toBe("env-org")
  expect(KiloAccount.compatible(override)).toBe(false)
  expect(KiloAccount.compatible(KiloAccount.resolve({ token: "plain", organizationID: null }, {}))).toBe(true)
})

test("builds Kilo provider headers without OpenCode attribution", () => {
  expect(KiloHeaders.provider({ version: "2.0.0", organizationID: "team" }, {})).toEqual({
    "HTTP-Referer": "https://kilocode.ai",
    "X-Title": "Kilo Code",
    "X-KILOCODE-EDITORNAME": "Kilo CLI 2.0.0",
    "X-KILOCODE-FEATURE": "cli",
    "X-KILOCODE-ORGANIZATIONID": "team",
  })
  expect(
    KiloHeaders.provider(
      { version: "2.0.0", organizationID: null },
      { KILOCODE_EDITOR_NAME: "Visual Studio Code 1.110.0", KILOCODE_FEATURE: "vscode-extension" },
    ),
  ).toEqual({
    "HTTP-Referer": "https://kilocode.ai",
    "X-Title": "Kilo Code",
    "X-KILOCODE-EDITORNAME": "Visual Studio Code 1.110.0",
    "X-KILOCODE-FEATURE": "vscode-extension",
  })
  expect(KiloHeaders.provider({ version: "local" }, { KILOCODE_VERSION: "7.1.0" })["X-KILOCODE-EDITORNAME"]).toBe(
    "Kilo CLI 7.1.0",
  )
})
