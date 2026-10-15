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
  expect(KiloServer.gateway("https://staging.kilo.test", {})).toBe("https://staging.kilo.test/api/gateway")
})

test("reads the server from a token like v1", () => {
  expect(KiloServer.fromToken("http://localhost:3000:secret")).toBe("http://localhost:3000")
  expect(KiloServer.fromToken("http://localhost:3000:1234")).toBe("http://localhost:3000")
  expect(KiloServer.fromToken("http://localhost:3000:abc:def")).toBe("http://localhost:3000")
  expect(KiloServer.fromToken("https://staging.example.test/base:secret")).toBe("https://staging.example.test/base")
  expect(KiloServer.fromToken("https://staging.example.test/base:123")).toBe("https://staging.example.test/base")
  expect(KiloServer.fromToken("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toBeUndefined()
})

test("reads environment tokens in v1 and cloud-consumer order", () => {
  expect(KiloAccount.envToken({})).toBeUndefined()
  expect(KiloAccount.envToken({ KILO_API_KEY: "api-key", KILOCODE_TOKEN: "cloud-token" })).toEqual({
    token: "api-key",
  })
  expect(KiloAccount.envToken({ KILOCODE_TOKEN: "cloud-token" })).toEqual({
    token: "cloud-token",
  })
  expect(
    KiloAccount.envToken({
      KILO_AUTH_CONTENT: JSON.stringify({ kilo: { access: "content-token", accountId: "content-team" } }),
    }),
  ).toEqual({
    token: "content-token",
    organizationID: "content-team",
  })
})

test("resolves the account server and team in v1 order", () => {
  expect(KiloAccount.resolve({ token: "plain" }, {})).toEqual({
    token: "plain",
    server: "https://api.kilo.ai",
    organizationID: null,
  })
  expect(
    KiloAccount.resolve({ token: "plain", server: "https://login.example.test/", organizationID: "team" }, {
      KILO_API_URL: "https://env.example.test",
    }),
  ).toEqual({ token: "plain", server: "https://login.example.test", organizationID: "team" })
  expect(
    KiloAccount.resolve({ token: "http://localhost:3000:secret", server: "https://login.example.test" }, {
      KILO_ORG_ID: "env-team",
    }),
  ).toEqual({ token: "http://localhost:3000:secret", server: "http://localhost:3000", organizationID: "env-team" })
  expect(
    KiloAccount.resolve({ token: "https://gateway.test/api/organizations/token-org:secret" }, {}),
  ).toEqual({
    token: "https://gateway.test/api/organizations/token-org:secret",
    server: "https://gateway.test/api/organizations/token-org",
    organizationID: "token-org",
  })
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
