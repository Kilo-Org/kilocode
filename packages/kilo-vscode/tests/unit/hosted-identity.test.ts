import { describe, expect, test } from "bun:test"
import { hostedKey, isHostedKey, parseHostedKey } from "../../src/hosted/identity"

describe("hosted identity", () => {
  test("mints a namespaced key that cannot look local", () => {
    expect(hostedKey("kilo-cloud", "ses_1")).toBe("host:kilo-cloud:ses_1")
    expect(hostedKey("kilo-cloud", "ses_1").startsWith("ses_")).toBe(false)
    expect(hostedKey("kilo-cloud", "ses_1").startsWith("cloud:")).toBe(false)
  })

  test("round-trips provider and native session identity", () => {
    expect(parseHostedKey(hostedKey("kilo-cloud", "ses_1"))).toEqual({
      providerID: "kilo-cloud",
      sessionID: "ses_1",
    })
  })

  test("rejects local, cloud-preview, and malformed keys", () => {
    expect(isHostedKey("ses_1")).toBe(false)
    expect(isHostedKey("cloud:ses_1")).toBe(false)
    expect(isHostedKey(undefined)).toBe(false)
    expect(parseHostedKey("host:")).toBeUndefined()
    expect(parseHostedKey("host:kilo-cloud")).toBeUndefined()
    expect(parseHostedKey("host::ses_1")).toBeUndefined()
    expect(parseHostedKey("host:kilo-cloud:")).toBeUndefined()
  })

  test("keeps colliding native ids distinct across providers", () => {
    expect(hostedKey("alpha", "ses_same")).not.toBe(hostedKey("beta", "ses_same"))
  })
})
