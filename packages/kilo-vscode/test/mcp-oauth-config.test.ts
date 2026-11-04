import { describe, expect, test } from "bun:test"
import {
  oauthFields,
  oauthMode,
  oauthPatch,
  validateOauth,
  type OauthFields,
} from "../webview-ui/src/components/settings/agent-behaviour/mcp-oauth-config"

const fields = (partial: Partial<OauthFields> = {}): OauthFields => ({
  clientId: "",
  clientSecret: "",
  scope: "",
  callbackPort: "",
  redirectUri: "",
  ...partial,
})

describe("oauthMode", () => {
  test("maps an absent value to automatic and false to disabled", () => {
    expect(oauthMode(undefined)).toBe("automatic")
    expect(oauthMode(null)).toBe("automatic")
    expect(oauthMode(false)).toBe("disabled")
  })

  test("maps an object to custom", () => {
    expect(oauthMode({ client_id: "abc" })).toBe("custom")
  })
})

describe("oauthFields", () => {
  test("reads snake_case keys and stringifies the port", () => {
    expect(oauthFields({ client_id: "abc", client_secret: "sh", scope: "read", callback_port: 8080, redirect_uri: "https://x" })).toEqual({
      clientId: "abc",
      clientSecret: "sh",
      scope: "read",
      callbackPort: "8080",
      redirectUri: "https://x",
    })
  })

  test("returns empty fields for automatic and disabled", () => {
    expect(oauthFields(undefined)).toEqual(fields())
    expect(oauthFields(false)).toEqual(fields())
  })
})

describe("oauthPatch", () => {
  test("automatic removes the key and disabled writes false", () => {
    expect(oauthPatch("automatic", fields())).toBeUndefined()
    expect(oauthPatch("disabled", fields())).toBe(false)
  })

  test("custom keeps only non-blank fields and parses the port", () => {
    expect(oauthPatch("custom", fields({ clientId: " id ", callbackPort: "3000", scope: "  " }))).toEqual({
      client_id: "id",
      client_secret: undefined,
      scope: undefined,
      callback_port: 3000,
      redirect_uri: undefined,
    })
  })
})

describe("validateOauth", () => {
  test("accepts automatic and disabled without checking fields", () => {
    expect(validateOauth("automatic", fields({ callbackPort: "nope" }))).toEqual({})
    expect(validateOauth("disabled", fields({ redirectUri: "nope" }))).toEqual({})
  })

  test("flags a port outside 1-65535 and a bad redirect URI", () => {
    expect(validateOauth("custom", fields({ callbackPort: "70000" })).callbackPort).toBeDefined()
    expect(validateOauth("custom", fields({ redirectUri: "not a url" })).redirectUri).toBeDefined()
  })

  test("flags a secret without a client id", () => {
    expect(validateOauth("custom", fields({ clientSecret: "sh" })).secret).toBeDefined()
    expect(validateOauth("custom", fields({ clientId: "id", clientSecret: "sh" })).secret).toBeUndefined()
  })

  test("accepts a valid custom client", () => {
    expect(validateOauth("custom", fields({ clientId: "id", callbackPort: "8080", redirectUri: "https://host/cb" }))).toEqual({})
  })
})
