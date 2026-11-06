import { describe, expect, test } from "bun:test"
import { assertNoSecrets } from "../src/redact"

describe("evidence secret rejection", () => {
  test("rejects secret-bearing field names at any depth", () => {
    for (const key of [
      "accessToken",
      "session-token",
      "apiKey",
      "authorization",
      "cookie",
      "setCookie",
      "password",
      "clientSecret",
      "credentials",
      "privateKey",
      "descriptor",
      "privateDescriptor",
      "fixtureDescriptor",
      "cleanupToken",
    ]) {
      expect(() => assertNoSecrets({ [key]: "value" })).toThrow()
    }
    expect(() => assertNoSecrets({ lastState: { authorization: "value" } })).toThrow()
    expect(() => assertNoSecrets({ assertions: [{ name: "x", detail: "y", cookie: "z" }] })).toThrow()
    expect(() => assertNoSecrets([{ nested: [{ accessToken: "x" }] }])).toThrow()
  })

  test("rejects secret-shaped values", () => {
    expect(() => assertNoSecrets({ detail: "Bearer abcdefghijklmnop1234" })).toThrow()
    expect(() => assertNoSecrets({ detail: "Bearer eyJhbGciOiJIUzI1NiJ9 (expires in 3600s)" })).toThrow()
    expect(() => assertNoSecrets({ detail: "Basic dXNlcjpwYXNzd29yZA==" })).toThrow()
    expect(() => assertNoSecrets({ detail: "sk-live-secret" })).toThrow()
    expect(() => assertNoSecrets({ detail: "ghp_abcdefghij" })).toThrow()
    expect(() => assertNoSecrets({ detail: "eyJabcdefgh.abcdefgh.abcdefgh" })).toThrow()
    expect(() => assertNoSecrets({ detail: "-----BEGIN RSA PRIVATE KEY-----" })).toThrow()
    expect(() => assertNoSecrets({ token: "sk-live-secret" })).toThrow()
  })

  test("allows non-secret token names and prose", () => {
    expect(() =>
      assertNoSecrets({
        lastState: { token: "K1-PROMPT-STREAM", tokens: 12, tokenCount: 12 },
        detail: "basic authentication required",
      }),
    ).not.toThrow()
  })

  test("accepts redacted evidence content", () => {
    expect(() =>
      assertNoSecrets({
        scenarioId: "prompt.stream",
        lastState: { terminal: "K1-PROMPT-STREAM", projectCommit: "a".repeat(40) },
        artifacts: { logs: ["artifacts/logs/driver.log"] },
      }),
    ).not.toThrow()
  })

  test("reports the offending path without the value", () => {
    try {
      assertNoSecrets({ lastState: { authorization: "Bearer secret-value" } })
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("$.lastState.authorization")
      expect((error as Error).message).not.toContain("secret-value")
      return
    }
    throw new Error("expected secret rejection")
  })
})
