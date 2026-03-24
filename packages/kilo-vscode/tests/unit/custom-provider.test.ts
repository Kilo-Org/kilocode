import { describe, expect, it } from "bun:test"
import {
  parseCustomProviderSecret,
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
