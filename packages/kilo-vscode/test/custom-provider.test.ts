// The custom provider form's mapping to the v2 `providers.<id>` config value: package, base URL, headers, model
// capabilities (reasoning, image) and the `{env:VAR}` API-key spelling.
import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { applyConfigEdits } from "../src/config-file-edit"
import {
  disabledProviderIds,
  disabledProviderOptions,
  enableProvider,
  isCustomProvider,
  isCustomProviderPackage,
  withDisabledProviders,
} from "../webview-ui/src/components/settings/provider-visibility"
import {
  INVALID_ENV,
  mergeProviderConfig,
  parseEnvKey,
  unmaskKey,
  validateCustomProvider,
  type CustomProviderConfigValue,
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
  apiKeyTouched: true,
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

  test("rejects an {env:VAR} spelling with an invalid variable name", () => {
    const output = validateCustomProvider({ ...base, form: form({ apiKey: "{env:lower}" }) })
    expect(output.result).toBeUndefined()
    expect(output.errors.apiKey).toBe(INVALID_ENV)
  })

  test("unmasks the first key edit and keeps asterisks of a pasted key", () => {
    const mask = "********"
    expect(unmaskKey("********sk-1", mask)).toBe("sk-1")
    expect(unmaskKey("sk-1********", mask)).toBe("sk-1")
    expect(unmaskKey("****sk-1****", mask)).toBe("sk-1")
    expect(unmaskKey("*******", mask)).toBe("")
    expect(unmaskKey("sk*abc*def", mask)).toBe("sk*abc*def")
  })

  test("keeps the existing env and no key when the key field is untouched", () => {
    const output = validateCustomProvider({
      ...base,
      editing: true,
      apiKeyTouched: false,
      existingEnv: ["MY_KEY"],
      form: form({ apiKey: "********" }),
    })
    expect(output.result?.key).toBeUndefined()
    expect(output.result?.config.env).toEqual(["MY_KEY"])
  })

  test("drops the existing env when a real key is typed", () => {
    const output = validateCustomProvider({
      ...base,
      editing: true,
      apiKeyTouched: true,
      existingEnv: ["MY_KEY"],
      form: form({ apiKey: "sk-1234" }),
    })
    expect(output.result?.key).toBe("sk-1234")
    expect(output.result?.config.env).toBeUndefined()
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

describe("provider-visibility", () => {
  test("recognizes only the custom provider packages", () => {
    expect(isCustomProviderPackage("@opencode/ai/providers/openai-compatible")).toBe(true)
    expect(isCustomProviderPackage("@opencode/ai/providers/openai")).toBe(true)
    expect(isCustomProviderPackage("@opencode/ai/providers/anthropic-compatible")).toBe(true)
    expect(isCustomProviderPackage("@opencode/ai/providers/anthropic")).toBe(false)
    expect(isCustomProvider({ package: "@opencode/ai/providers/openai-compatible" })).toBe(true)
    expect(isCustomProvider({ name: "Anthropic" })).toBe(false)
    expect(isCustomProvider(undefined)).toBe(false)
  })

  test("lists the providers that are not disabled, sorted by name", () => {
    const items = [
      { id: "vercel", name: "Vercel" },
      { id: "anthropic", name: "Anthropic" },
      { id: "acme", name: "Acme" },
    ] as never[]
    expect(disabledProviderOptions(items, ["vercel"])).toEqual([
      { value: "acme", label: "Acme" },
      { value: "anthropic", label: "Anthropic" },
    ])
  })

  test("reads the disabled ids and ignores a legacy allow-list catch-all", () => {
    expect(
      disabledProviderIds([
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "anthropic", effect: "allow" },
        { action: "provider.use", resource: "vercel", effect: "deny" },
      ]),
    ).toEqual(["vercel"])
    expect(disabledProviderIds(undefined)).toEqual([])
  })

  test("replaces the per-provider denies and keeps the catch-all and other policies", () => {
    const policies = [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "anthropic", effect: "allow" },
      { action: "provider.use", resource: "vercel", effect: "deny" },
      { action: "tool.use", resource: "bash", effect: "deny" },
    ]
    expect(withDisabledProviders(policies, ["deepseek"])).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "anthropic", effect: "allow" },
      { action: "tool.use", resource: "bash", effect: "deny" },
      { action: "provider.use", resource: "deepseek", effect: "deny" },
    ])
  })

  test("enables a saved provider whose id is disabled", () => {
    const policies = [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "deepseek", effect: "deny" },
      { action: "provider.use", resource: "vercel", effect: "deny" },
    ]
    expect(enableProvider(policies, "deepseek")).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "vercel", effect: "deny" },
    ])
    expect(enableProvider([{ action: "provider.use", resource: "deepseek", effect: "deny" }], "deepseek")).toEqual([])
    expect(enableProvider(policies, "acme")).toBeUndefined()
    expect(enableProvider(undefined, "acme")).toBeUndefined()
  })
})

describe("mergeProviderConfig", () => {
  const produced: CustomProviderConfigValue = {
    name: "Acme",
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: "https://new.example/v1" },
    models: { a: { name: "A", capabilities: { input: ["text"] } } },
  }

  test("returns the produced value when there is nothing to merge", () => {
    expect(mergeProviderConfig(undefined, produced)).toEqual(produced)
  })

  test("keeps unmodeled provider and model fields", () => {
    const existing = {
      name: "Old",
      package: "@opencode/ai/providers/openai-compatible",
      compatibility: "compatible",
      body: { temperature: 0.5 },
      settings: { baseURL: "https://old.example/v1", timeout: 9000 },
      models: {
        a: {
          name: "Old A",
          limit: { context: 1000 },
          cost: { input: 1 },
          variants: [{ id: "high" }],
          capabilities: { output: ["text"], reasoning: { supported: true } },
        },
      },
    }
    const merged = mergeProviderConfig(existing, produced) as unknown as Record<string, any>
    expect(merged.settings).toEqual({ baseURL: "https://new.example/v1", timeout: 9000 })
    expect(merged.body).toEqual({ temperature: 0.5 })
    expect(merged.compatibility).toBe("compatible")
    expect(merged.models.a.limit).toEqual({ context: 1000 })
    expect(merged.models.a.cost).toEqual({ input: 1 })
    expect(merged.models.a.variants).toEqual([{ id: "high" }])
    expect(merged.models.a.name).toBe("A")
    expect(merged.models.a.capabilities).toEqual({ input: ["text"], output: ["text"] })
  })

  test("removes a model the dialog no longer lists and clears reasoning when unchecked", () => {
    const existing = {
      models: {
        a: { name: "A", capabilities: { reasoning: { supported: true } } },
        b: { name: "B" },
      },
    }
    const merged = mergeProviderConfig(existing, produced) as unknown as Record<string, any>
    expect(Object.keys(merged.models)).toEqual(["a"])
    expect(merged.models.a.capabilities.reasoning).toBeUndefined()
  })

  test("keeps the other input modalities when Image is off and adds image when on", () => {
    const off = mergeProviderConfig(
      { models: { a: { capabilities: { input: ["text", "image", "pdf"] } } } },
      produced,
    ) as unknown as Record<string, any>
    expect(off.models.a.capabilities.input).toEqual(["text", "pdf"])

    const on = mergeProviderConfig(
      { models: { a: { capabilities: { input: ["text", "pdf"] } } } },
      { ...produced, models: { a: { name: "A", capabilities: { input: ["text", "image"] } } } },
    ) as unknown as Record<string, any>
    expect(on.models.a.capabilities.input).toEqual(["text", "pdf", "image"])
  })

  test("keeps the reasoning sub-fields while reasoning stays on", () => {
    const merged = mergeProviderConfig(
      { models: { a: { capabilities: { reasoning: { supported: true, effort: ["low"], budget: { min: 1 } } } } } },
      { ...produced, models: { a: { name: "A", capabilities: { input: ["text"], reasoning: { supported: true } } } } },
    ) as unknown as Record<string, any>
    expect(merged.models.a.capabilities.reasoning).toEqual({ supported: true, effort: ["low"], budget: { min: 1 } })
  })

  test("removes headers when the dialog has none", () => {
    const merged = mergeProviderConfig({ headers: { "X-Old": "1" } }, produced) as unknown as Record<string, any>
    expect(merged.headers).toBeUndefined()
  })
})

describe("applyConfigEdits for providers", () => {
  test("writes providers.<id> when the provider alias is absent", () => {
    const value = {
      name: "Acme",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "https://x" },
    }
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
