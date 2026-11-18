import { describe, expect, test } from "bun:test"
import { KiloCredential } from "../src/index.js"

describe("KiloCredential.token", () => {
  test("reads the access token of an oauth credential", () => {
    expect(KiloCredential.token({ type: "oauth", access: "access-token" })).toBe("access-token")
  })

  test("reads the key of a key credential", () => {
    expect(KiloCredential.token({ type: "key", key: "api-key" })).toBe("api-key")
  })

  test("has no token for an external credential source", () => {
    expect(KiloCredential.token({ type: "external" })).toBeUndefined()
  })
})
