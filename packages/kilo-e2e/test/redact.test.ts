import { describe, expect, test } from "bun:test"
import { assertNoSecrets } from "../src/redact"

describe("evidence secret rejection", () => {
  test("rejects secret-bearing field names at any depth", () => {
    for (const key of [
      "token",
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
    expect(() => assertNoSecrets([{ nested: [{ token: "x" }] }])).toThrow()
  })

  test("rejects secret-shaped values", () => {
    expect(() => assertNoSecrets({ detail: "Bearer abc123" })).toThrow()
    expect(() => assertNoSecrets({ detail: "sk-live-secret" })).toThrow()
    expect(() => assertNoSecrets({ detail: "ghp_abcdefghij" })).toThrow()
    expect(() => assertNoSecrets({ detail: "eyJabcdefgh.abcdefgh.abcdefgh" })).toThrow()
    expect(() => assertNoSecrets({ detail: "-----BEGIN RSA PRIVATE KEY-----" })).toThrow()
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
