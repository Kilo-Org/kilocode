import { describe, expect, it } from "bun:test"
import {
  MASKED_CUSTOM_PROVIDER_KEY,
  parseCustomProviderSecret,
  resolveCustomProviderKey,
  resolveCustomProviderAuth,
  sanitizeCustomProviderConfig,
  validateProviderID,
} from "../../src/shared/custom-provider"

describe("validateProviderID", () => {
  it("accepts valid provider ids", () => {
    expect(validateProviderID(" my-provider_1 ")).toEqual({ value: "my-provider_1" })
  })

  it("rejects invalid provider ids", () => {
    const result = validateProviderID("bad/id")
    expect("error" in result ? result.error : "").toBe("Invalid provider ID")
  })
})

describe("parseCustomProviderSecret", () => {
  it("treats plain values as api keys", () => {
    expect(parseCustomProviderSecret(" sk-test ")).toEqual({ value: { apiKey: "sk-test" } })
  })

  it("parses env references", () => {
    expect(parseCustomProviderSecret(" {env:MY_PROVIDER_KEY} ")).toEqual({ value: { env: "MY_PROVIDER_KEY" } })
  })

  it("rejects invalid env references", () => {
    const result = parseCustomProviderSecret("{env:bad-name}")
    expect("error" in result ? result.error : "").toBe("Invalid environment variable name")
  })
})

describe("resolveCustomProviderAuth", () => {
  it("preserves auth when the api key field is unchanged", () => {
    expect(resolveCustomProviderAuth(undefined, false)).toEqual({ mode: "preserve" })
  })

  it("stores a changed api key", () => {
    expect(resolveCustomProviderAuth(" sk-test ", true)).toEqual({ mode: "set", key: "sk-test" })
  })

  it("clears auth when the field was changed to empty", () => {
    expect(resolveCustomProviderAuth(undefined, true)).toEqual({ mode: "clear" })
  })
})

describe("resolveCustomProviderKey", () => {
  it("returns a masked value for api-backed providers", () => {
    expect(resolveCustomProviderKey("api")).toBe(MASKED_CUSTOM_PROVIDER_KEY)
  })

  it("hides non-api auth from the edit form", () => {
    expect(resolveCustomProviderKey("oauth")).toBe("")
  })

  it("returns empty when there is no saved key", () => {
    expect(resolveCustomProviderKey(undefined)).toBe("")
  })
})

describe("sanitizeCustomProviderConfig", () => {
  it("normalizes config and forces the approved package", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "malicious-package",
      name: " My Provider ",
      env: [" MY_PROVIDER_KEY "],
      options: {
        baseURL: "https://example.com/v1 ",
        headers: {
          Authorization: " Bearer test ",
          " X-Test ": " 123 ",
        },
      },
      models: {
        " model-1 ": { name: " Model One " },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "My Provider",
        env: ["MY_PROVIDER_KEY"],
        options: {
          baseURL: "https://example.com/v1",
          headers: {
            Authorization: "Bearer test",
            "X-Test": "123",
          },
        },
        models: {
          "model-1": { name: "Model One" },
        },
      },
    })
  })

  it("accepts models with chat_template_args variant", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Thinking Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          variants: {
            thinking: { chat_template_args: { enable_thinking: true } },
          },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Thinking Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            variants: {
              thinking: { chat_template_args: { enable_thinking: true } },
            },
          },
        },
      },
    })
  })

  it("rejects unknown fields", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Bad Provider",
      options: {
        baseURL: "https://example.com/v1",
        mcpServer: "https://malicious.example",
      },
      models: { "model-1": { name: "Model One" } },
    })

    expect("error" in result ? result.error : "").toContain("mcpServer")
  })
})
