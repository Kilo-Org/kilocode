// The custom provider form's mapping to the v2 `providers.<id>` config value: package, base URL, headers, model
// capabilities (reasoning, image) and the `{env:VAR}` API-key spelling.
import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { applyConfigEdits } from "../src/config-file-edit"
import {
  parseEnvKey,
  validateCustomProvider,
  type FormState,
} from "../webview-ui/src/components/settings/CustomProviderValidation"

const t = (key: string) => key

function form(overrides: Partial<FormState> = {}): FormState {
  return {
    providerID: "myprovider",
    name: "My Provider",
    package: "@opencode/ai/providers/openai-compatible",
    baseURL: "https://api.example.com/v1",
    apiKey: "",
    models: [{ id: "gpt-x", name: "GPT X", reasoning: false, supportsImages: false }],
    headers: [{ key: "", value: "" }],
    saving: false,
    ...overrides,
  }
}

const base = {
  t,
  editing: false,
  disabledProviders: [] as string[],
  existingProviderIDs: new Set<string>(),
}

describe("validateCustomProvider", () => {
  test("maps a model to name and capabilities", () => {
    const output = validateCustomProvider({
      ...base,
      form: form({
        models: [
          { id: "a", name: "A", reasoning: true, supportsImages: true },
          { id: "b", name: "B", reasoning: false, supportsImages: false },
        ],
      }),
    })

    expect(output.errors.models.every((error) => !error.id && !error.name)).toBe(true)
    expect(output.result?.config).toEqual({
      name: "My Provider",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "https://api.example.com/v1" },
      models: {
        a: { name: "A", capabilities: { input: ["text", "image"], reasoning: { supported: true } } },
        b: { name: "B", capabilities: { input: ["text"] } },
      },
    })
  })

  test("writes headers only when complete and returns the key separately", () => {
    const output = validateCustomProvider({
      ...base,
      form: form({
        apiKey: "sk-123",
        headers: [
          { key: "X-Org", value: "acme" },
          { key: "", value: "" },
        ],
      }),
    })

    expect(output.result?.key).toBe("sk-123")
    expect(output.result?.config.headers).toEqual({ "X-Org": "acme" })
  })

  test("maps the {env:VAR} spelling to an env entry and no key", () => {
    const output = validateCustomProvider({ ...base, form: form({ apiKey: "{env:MY_KEY}" }) })
    expect(parseEnvKey("{env:MY_KEY}")).toBe("MY_KEY")
    expect(output.result?.key).toBeUndefined()
    expect(output.result?.config.env).toEqual(["MY_KEY"])
  })

  test("rejects a bad provider ID and a duplicate model ID", () => {
    const output = validateCustomProvider({
      ...base,
      form: form({
        providerID: "Bad ID",
        models: [
          { id: "dup", name: "A", reasoning: false, supportsImages: false },
          { id: "DUP", name: "B", reasoning: false, supportsImages: false },
        ],
      }),
    })

    expect(output.result).toBeUndefined()
    expect(output.errors.providerID).toBe("provider.custom.error.providerID.format")
    expect(output.errors.models[1]?.id).toBe("provider.custom.error.duplicate")
  })

  test("requires an http base URL", () => {
    const output = validateCustomProvider({ ...base, form: form({ baseURL: "api.example.com" }) })
    expect(output.result).toBeUndefined()
    expect(output.errors.baseURL).toBe("provider.custom.error.baseURL.format")
  })
})

describe("applyConfigEdits for providers", () => {
  test("writes providers.<id> when the provider alias is absent", () => {
    const value = { name: "Acme", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "https://x" } }
    const result = applyConfigEdits('{"$schema":"x"}', [{ path: ["providers", "acme"], value }])
    expect(parse(result).providers.acme).toEqual(value)
  })

  test("removes the provider alias when it exists", () => {
    const result = applyConfigEdits('{"provider":{"acme":{"npm":"old"}}}', [
      { path: ["providers", "acme"], value: { name: "Acme" } },
    ])
    expect(parse(result).providers.acme).toEqual({ name: "Acme" })
    expect(parse(result).provider.acme).toBeUndefined()
  })
})
