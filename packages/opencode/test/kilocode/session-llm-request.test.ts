import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { ModelMessage } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Agent } from "@/agent/agent"
import type { Auth } from "@/auth"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLMRequestPrep } from "@/session/llm/request"
import { MessageID, SessionID } from "@/session/schema"
import { SystemPrompt } from "@/session/system"

const model: Provider.Model = {
  id: ModelV2.ID.make("test-model"),
  providerID: ProviderV2.ID.make("test"),
  api: {
    id: "test-model",
    url: "https://example.com/v1",
    npm: "@ai-sdk/openai",
  },
  name: "Test model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128_000, output: 32_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const plugin: Plugin.Interface = {
  init: () => Effect.void,
  trigger: (_name, _input, output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
}

function agent(name: string): Agent.Info {
  return {
    name,
    mode: "primary",
    options: {},
    permission: [],
    prompt: `${name} generation prompt`,
  }
}

function user(name: string): SessionV1.User {
  return {
    id: MessageID.make("msg_test"),
    sessionID: SessionID.make("ses_test"),
    role: "user",
    time: { created: Date.now() },
    agent: name,
    model: { providerID: model.providerID, modelID: model.id },
    system: "request-specific system text",
  }
}

async function prepare(name: string, oauth = false) {
  const auth: Auth.Info | undefined = oauth
    ? { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 60_000 }
    : undefined
  const provider: Provider.Info = {
    id: ProviderV2.ID.make(oauth ? "openai" : "test"),
    name: "Test provider",
    source: "config",
    env: [],
    options: {},
    models: {},
  }
  const flags = await Effect.runPromise(
    RuntimeFlags.Service.pipe(Effect.provide(RuntimeFlags.layer({ client: "test" }))),
  )
  return Effect.runPromise(
    LLMRequestPrep.prepare({
      user: user(name),
      sessionID: "ses_test",
      model,
      agent: agent(name),
      system: [],
      messages: [{ role: "user", content: "Generate a name" }] satisfies ModelMessage[],
      tools: {},
      provider,
      auth,
      plugin,
      flags,
      isWorkflow: false,
    }),
  )
}

describe("Kilo persona in generated metadata requests", () => {
  test.each(["title", "branch-name"])("omits the persona for %s generation", async (name) => {
    const result = await prepare(name)

    expect(result.system[0]).toContain(`${name} generation prompt`)
    expect(result.system[0]).toContain("request-specific system text")
    expect(result.system[0]).not.toContain(SystemPrompt.soul())
  })

  test.each(["title", "branch-name"])("omits the persona from OpenAI OAuth %s generation", async (name) => {
    const result = await prepare(name, true)

    expect(result.params.options.instructions).toContain(`${name} generation prompt`)
    expect(result.params.options.instructions).toContain("request-specific system text")
    expect(result.params.options.instructions).not.toContain(SystemPrompt.soul())
  })

  test("keeps the persona for ordinary agent requests", async () => {
    const result = await prepare("code")
    const oauth = await prepare("code", true)

    expect(result.system[0]).toContain(SystemPrompt.soul())
    expect(oauth.params.options.instructions).toContain(SystemPrompt.soul())
  })
})
