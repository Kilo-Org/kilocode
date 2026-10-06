import { describe, expect, it } from "bun:test"
import {
  oauthMode,
  oauthPatch,
  validateOauth,
  type OauthFields,
} from "../../webview-ui/src/components/settings/mcp-oauth-config"

const EMPTY: OauthFields = { clientId: "", clientSecret: "", scope: "", callbackPort: "", redirectUri: "" }

describe("oauthMode", () => {
  it("maps undefined/null oauth to automatic", () => {
    expect(oauthMode(undefined)).toBe("automatic")
    expect(oauthMode(null)).toBe("automatic")
  })

  it("maps oauth: false to disabled", () => {
    expect(oauthMode(false)).toBe("disabled")
  })

  it("maps any oauth object to custom", () => {
    expect(oauthMode({})).toBe("custom")
    expect(oauthMode({ clientId: "abc" })).toBe("custom")
  })
})

describe("oauthPatch", () => {
  it("automatic produces null (explicit removal)", () => {
    expect(oauthPatch("automatic", EMPTY)).toBeNull()
  })

  it("disabled produces false", () => {
    expect(oauthPatch("disabled", EMPTY)).toBe(false)
  })

  it("custom produces an object with only non-blank fields, port coerced to a number", () => {
    const patch = oauthPatch("custom", {
      clientId: "abc",
      clientSecret: "shh",
      scope: "read",
      callbackPort: "19999",
      redirectUri: "",
    })
    expect(patch).toEqual({
      clientId: "abc",
      clientSecret: "shh",
      scope: "read",
      callbackPort: 19999,
      redirectUri: undefined,
    })
  })

  it("custom with every field blank still produces an object (not null/false)", () => {
    const patch = oauthPatch("custom", EMPTY)
    expect(patch).toEqual({
      clientId: undefined,
      clientSecret: undefined,
      scope: undefined,
      callbackPort: undefined,
      redirectUri: undefined,
    })
  })
})

describe("validateOauth", () => {
  it("skips validation outside custom mode", () => {
    expect(validateOauth("automatic", { ...EMPTY, callbackPort: "999999" })).toEqual({})
    expect(validateOauth("disabled", { ...EMPTY, clientSecret: "shh" })).toEqual({})
  })

  it("rejects an out-of-range callback port", () => {
    expect(validateOauth("custom", { ...EMPTY, callbackPort: "0" }).callbackPort).toBeDefined()
    expect(validateOauth("custom", { ...EMPTY, callbackPort: "65536" }).callbackPort).toBeDefined()
    expect(validateOauth("custom", { ...EMPTY, callbackPort: "19999" }).callbackPort).toBeUndefined()
  })

  it("rejects a non-numeric callback port", () => {
    expect(validateOauth("custom", { ...EMPTY, callbackPort: "abc" }).callbackPort).toBeDefined()
  })

  it("requires a client ID when a client secret is set", () => {
    expect(validateOauth("custom", { ...EMPTY, clientSecret: "shh" }).secret).toBeDefined()
    expect(validateOauth("custom", { ...EMPTY, clientId: "abc", clientSecret: "shh" }).secret).toBeUndefined()
  })

  it("rejects a non-absolute redirect URI", () => {
    expect(validateOauth("custom", { ...EMPTY, redirectUri: "/callback" }).redirectUri).toBeDefined()
    expect(
      validateOauth("custom", { ...EMPTY, redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback" }).redirectUri,
    ).toBeUndefined()
  })

  it("passes with every field blank", () => {
    expect(validateOauth("custom", EMPTY)).toEqual({})
  })
})
