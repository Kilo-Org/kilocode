// The custom provider form's mapping to the v2 `providers.<id>` config value: package, base URL, headers, model
// capabilities (reasoning, image) and the `{env:VAR}` API-key spelling.
import { describe, expect, test } from "bun:test"
import { Document, Info } from "@opencode/schema/config"
import type { ConfigPolicy } from "@opencode/schema/config/policy"
import { parse } from "jsonc-parser"
import { ConfigNormalize } from "../../core/src/config/normalize"
import { ManagedPolicy } from "../../core/src/managed-policy"
import { applyConfigEdits } from "../src/config-file-edit"
import {
  canDisconnect,
  canManageProvider,
  disabledProviderIds,
  disabledProviderOptions,
  enableProvider,
  enableProviderInConfig,
  isCustomProvider,
  isCustomProviderPackage,
  providerRemovalPath,
  withDisabledProviders,
  type ProviderPolicy,
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

type Scope = "global" | "project"

function policyFixture(input: {
  global?: unknown
  project?: unknown
  system?: ProviderPolicy[]
  optimistic?: { scope: Scope; value: unknown }
}) {
  const paths = { global: "/global/kilo2.json", project: "/project/kilo2.json" }
  const files = {
    global: input.global === undefined ? "" : (JSON.stringify(input.global) ?? ""),
    project: input.project === undefined ? "" : (JSON.stringify(input.project) ?? ""),
  }
  const writes: Array<{ scope: Scope; value: unknown }> = []
  const write = async (scope: Scope, path: string[], value: unknown) => {
    files[scope] = applyConfigEdits(files[scope], [{ path, value }])
    writes.push({ scope, value })
    return true
  }
  const config = {
    entries: () => [
      ...(input.system ? [{ type: "document", path: "/system/kilo2.json", info: { policies: input.system } }] : []),
      ...(["global", "project"] as const).flatMap((scope) => {
        if (!files[scope]) return []
        const result = ConfigNormalize.normalize(parse(files[scope]))
        if (result.type !== "normalized") throw new Error("expected normalized config")
        return [
          {
            type: "document",
            path: paths[scope],
            info: { policies: result.encoded.policies as ProviderPolicy[] | undefined },
          },
        ]
      }),
    ],
    path: (scope: Scope) => paths[scope],
    optimistic: () => input.optimistic,
    set: (path: string[], value: unknown, scope: Scope) => write(scope, path, value),
    unset: (path: string[], scope: Scope) => write(scope, path, undefined),
  }
  return { config, files, writes }
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
    expect(unmaskKey("****x***", mask)).toBe("x")
    expect(unmaskKey("*********", mask)).toBe("*")
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

  test("offers custom provider actions for environment connections without allowing other env disconnects", () => {
    const env = { connections: [{ type: "env" as const, name: "CUSTOM_API_KEY" }] }
    const key = { connections: [{ type: "credential" as const, id: "cred_1", label: "Key", method: "key" as const }] }
    const custom = { package: "@opencode/ai/providers/openai-compatible" }
    expect(canDisconnect(env)).toBe(false)
    expect(canManageProvider(env, custom)).toBe(true)
    expect(canManageProvider(env, undefined)).toBe(false)
    expect(canDisconnect(key)).toBe(true)
    expect(canManageProvider(key, undefined)).toBe(true)
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

  test("retains the order of unrelated deny and allow rules when disabling a provider", () => {
    const policies = [
      { action: "provider.use", resource: "vercel", effect: "deny" },
      { action: "provider.use", resource: "vercel", effect: "allow" },
      { action: "provider.use", resource: "old", effect: "deny" },
    ]
    expect(withDisabledProviders(policies, ["vercel", "new"])).toEqual([
      policies[0],
      policies[1],
      { action: "provider.use", resource: "new", effect: "deny" },
    ])
  })

  test("enables saved or explicitly disabled providers under an allow-list", () => {
    const policies = [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "deepseek", effect: "deny" },
      { action: "provider.use", resource: "vercel", effect: "deny" },
    ]
    expect(enableProvider(policies, "deepseek")).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "vercel", effect: "deny" },
      { action: "provider.use", resource: "deepseek", effect: "allow" },
    ])
    expect(enableProvider([{ action: "provider.use", resource: "deepseek", effect: "deny" }], "deepseek")).toEqual([])
    expect(enableProvider(policies, "acme")).toEqual([
      ...policies,
      { action: "provider.use", resource: "acme", effect: "allow" },
    ])
    expect(enableProvider(undefined, "acme")).toBeUndefined()
  })

  test("follows the last matching wildcard rule without rewriting unrelated policies", () => {
    const policies = [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "acme-*", effect: "allow" },
      { action: "provider.use", resource: "other", effect: "deny" },
      { action: "provider.use", resource: "other", effect: "allow" },
    ]
    expect(enableProvider(policies, "acme-x")).toBeUndefined()
    expect(
      enableProvider([...policies, { action: "provider.use", resource: "acme-?", effect: "deny" }], "acme-x"),
    ).toEqual([
      ...policies,
      { action: "provider.use", resource: "acme-?", effect: "deny" },
      { action: "provider.use", resource: "acme-x", effect: "allow" },
    ])
    expect(
      enableProvider([...policies, { action: "provider.use", resource: "acme-x", effect: "deny" }], "acme-x"),
    ).toEqual(policies)
  })

  test("an empty legacy enabled list also needs a provider-specific allow", () => {
    const normalized = ConfigNormalize.normalize({ enabled_providers: [] })
    if (normalized.type !== "normalized") throw new Error("expected normalized config")
    expect(enableProvider(normalized.encoded.policies, "acme")).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "acme", effect: "allow" },
    ])
  })

  test("updates the deciding global policy and a project deny without mixing their contents", async () => {
    const fixture = policyFixture({
      global: {
        enabled_providers: ["anthropic"],
        disabled_providers: ["vercel"],
        experimental: { policies: [{ action: "tool.use", resource: "shell:*", effect: "deny" }] },
      },
      project: {
        policies: [
          { action: "provider.use", resource: "acme", effect: "deny" },
          { action: "integration.use", resource: "mcp:example", effect: "deny" },
        ],
      },
    })

    const decision = (id: string) =>
      ManagedPolicy.decision(
        ManagedPolicy.statements(
          fixture.config.entries().map(
            (entry) =>
              new Document({
                type: "document",
                info: new Info({ policies: entry.info.policies as ConfigPolicy.Info[] | undefined }),
              }),
          ),
          { statements: [] },
        ),
        "provider.use",
        id,
      )

    expect(decision("acme")).toBe("deny")
    expect(await enableProviderInConfig(fixture.config, "acme")).toBe(true)
    expect(decision("acme")).toBe("allow")
    expect(decision("anthropic")).toBe("allow")
    expect(decision("vercel")).toBe("deny")
    expect(decision("unlisted")).toBe("deny")
    expect(fixture.writes.map((write) => write.scope)).toEqual(["global", "project"])
    const global = parse(fixture.files.global)
    expect(global.enabled_providers).toBeUndefined()
    expect(global.disabled_providers).toBeUndefined()
    expect(global.experimental.policies).toBeUndefined()
    expect(global.policies).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "anthropic", effect: "allow" },
      { action: "provider.use", resource: "vercel", effect: "deny" },
      { action: "tool.use", resource: "shell:*", effect: "deny" },
      { action: "provider.use", resource: "acme", effect: "allow" },
    ])
    expect(parse(fixture.files.project).policies).toEqual([
      { action: "integration.use", resource: "mcp:example", effect: "deny" },
    ])
  })

  test("updates a project allow-list in its own scope", async () => {
    const fixture = policyFixture({
      global: { policies: [{ action: "integration.use", resource: "mcp:example", effect: "deny" }] },
      project: { enabled_providers: ["anthropic"] },
    })
    expect(await enableProviderInConfig(fixture.config, "acme")).toBe(true)
    expect(fixture.writes.map((write) => write.scope)).toEqual(["project"])
    expect(parse(fixture.files.global).policies).toEqual([
      { action: "integration.use", resource: "mcp:example", effect: "deny" },
    ])
    expect(parse(fixture.files.project).policies).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "anthropic", effect: "allow" },
      { action: "provider.use", resource: "acme", effect: "allow" },
    ])
  })

  test("does not overwrite a policy from an uneditable source", async () => {
    const fixture = policyFixture({ system: [{ action: "provider.use", resource: "*", effect: "deny" }] })
    expect(await enableProviderInConfig(fixture.config, "acme")).toBe(true)
    expect(fixture.writes).toEqual([])
  })

  test("enables a provider disabled by an optimistic write before the document reloads", async () => {
    const fixture = policyFixture({
      optimistic: {
        scope: "global",
        value: [{ action: "provider.use", resource: "acme", effect: "deny" }],
      },
    })
    expect(await enableProviderInConfig(fixture.config, "acme")).toBe(true)
    expect(fixture.writes).toEqual([{ scope: "global", value: undefined }])
  })

  test("keeps other optimistic policy changes in their original scope", async () => {
    const deny = { action: "provider.use", resource: "*", effect: "deny" }
    const fixture = policyFixture({
      global: { policies: [deny] },
      project: { policies: [] },
      optimistic: {
        scope: "global",
        value: [
          deny,
          { action: "provider.use", resource: "other", effect: "deny" },
          { action: "provider.use", resource: "acme", effect: "deny" },
        ],
      },
    })
    expect(await enableProviderInConfig(fixture.config, "acme")).toBe(true)
    expect(fixture.writes).toEqual([
      {
        scope: "global",
        value: [
          deny,
          { action: "provider.use", resource: "other", effect: "deny" },
          { action: "provider.use", resource: "acme", effect: "allow" },
        ],
      },
    ])
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

  test("removes a legacy-only provider without removing its siblings", () => {
    const text =
      '{"provider":{"acme":{"npm":"@opencode/ai/providers/openai-compatible","env":["ACME_KEY"]},"other":{"npm":"other"}}}'
    const normalized = ConfigNormalize.normalize(parse(text))
    if (normalized.type !== "normalized") throw new Error("expected normalized config")
    expect(isCustomProvider((normalized.encoded.providers as Record<string, unknown>).acme)).toBe(true)
    const result = applyConfigEdits(text, [{ path: providerRemovalPath(parse(text), "acme") }])
    expect(parse(result).provider).toEqual({ other: { npm: "other" } })
  })

  test("removes both provider spellings when the canonical parent exists", () => {
    const text = '{"providers":{"acme":{}},"provider":{"acme":{},"other":{}}}'
    const result = applyConfigEdits(text, [{ path: providerRemovalPath(parse(text), "acme") }])
    expect(parse(result).providers.acme).toBeUndefined()
    expect(parse(result).provider).toEqual({ other: {} })
  })
})
