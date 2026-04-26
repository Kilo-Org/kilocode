import { afterEach, beforeEach, expect, test } from "bun:test"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "@/plugin/cloudflare"

const pluginInput = {
  client: {} as never,
  project: {} as never,
  directory: "",
  worktree: "",
  experimental_workspace: {
    register() {},
  },
  serverUrl: new URL("https://example.com"),
  $: {} as never,
}

const ENV_KEYS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

function makeHookInput(overrides: { providerID?: string; apiId?: string; reasoning?: boolean }) {
  return {
    sessionID: "s",
    agent: "a",
    provider: {} as never,
    message: {} as never,
    model: {
      providerID: overrides.providerID ?? "cloudflare-ai-gateway",
      api: { id: overrides.apiId ?? "openai/gpt-5.2-codex", url: "", npm: "ai-gateway-provider" },
      capabilities: {
        reasoning: overrides.reasoning ?? true,
        temperature: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
    } as never,
  }
}

function makeHookOutput() {
  return { temperature: 0, topP: 1, topK: 0, maxOutputTokens: 32_000 as number | undefined, options: {} }
}

test("omits maxOutputTokens for openai reasoning models on cloudflare-ai-gateway", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(makeHookInput({ apiId: "openai/gpt-5.2-codex", reasoning: true }), out)
  expect(out.maxOutputTokens).toBeUndefined()
})

test("keeps maxOutputTokens for openai non-reasoning models", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(makeHookInput({ apiId: "openai/gpt-4-turbo", reasoning: false }), out)
  expect(out.maxOutputTokens).toBe(32_000)
})

test("keeps maxOutputTokens for non-openai reasoning models on cloudflare-ai-gateway", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(makeHookInput({ apiId: "anthropic/claude-sonnet-4-5", reasoning: true }), out)
  expect(out.maxOutputTokens).toBe(32_000)
})

test("ignores non-cloudflare-ai-gateway providers", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  const out = makeHookOutput()
  await hooks["chat.params"]!(makeHookInput({ providerID: "openai", apiId: "gpt-5.2-codex", reasoning: true }), out)
  expect(out.maxOutputTokens).toBe(32_000)
})

test("CloudflareWorkersAuthPlugin registers an api-token auth method for cloudflare-workers-ai", async () => {
  const hooks = await CloudflareWorkersAuthPlugin(pluginInput)
  expect(hooks.auth?.provider).toBe("cloudflare-workers-ai")
  expect(hooks.auth?.methods).toHaveLength(1)
  expect(hooks.auth?.methods[0]?.type).toBe("api")
  expect(hooks.auth?.methods[0]?.label).toBe("API token")
})

test("CloudflareWorkersAuthPlugin prompts for account ID when env is missing", async () => {
  const hooks = await CloudflareWorkersAuthPlugin(pluginInput)
  const prompts = hooks.auth?.methods[0]?.prompts ?? []
  expect(prompts).toHaveLength(1)
  expect(prompts[0]?.key).toBe("accountId")
})

test("CloudflareWorkersAuthPlugin omits account ID prompt when env is set", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "1234567890abcdef1234567890abcdef"
  const hooks = await CloudflareWorkersAuthPlugin(pluginInput)
  expect(hooks.auth?.methods[0]?.prompts ?? []).toHaveLength(0)
})

test("CloudflareAIGatewayAuthPlugin prompts for account ID and gateway ID when env is missing", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  const prompts = hooks.auth?.methods[0]?.prompts ?? []
  expect(prompts.map((p) => p.key)).toEqual(["accountId", "gatewayId"])
})

test("CloudflareAIGatewayAuthPlugin omits gateway ID prompt when only that env is set", async () => {
  process.env.CLOUDFLARE_GATEWAY_ID = "my-gateway"
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  const prompts = hooks.auth?.methods[0]?.prompts ?? []
  expect(prompts.map((p) => p.key)).toEqual(["accountId"])
})

test("CloudflareAIGatewayAuthPlugin omits all prompts when both env vars are set", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "1234567890abcdef1234567890abcdef"
  process.env.CLOUDFLARE_GATEWAY_ID = "my-gateway"
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  expect(hooks.auth?.methods[0]?.prompts ?? []).toHaveLength(0)
})
