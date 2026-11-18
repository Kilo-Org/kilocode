import { describe, expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { SystemPart } from "@opencode/ai/effect"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { OptimizePlugin } from "@opencode/core/plugin/optimize"
import { ClaudeInstructions } from "@opencode/core/plugin/provider/claude-agent/instructions"
import { ClaudeSystemPrompt } from "@opencode/core/plugin/provider/claude-agent/language-model/system-prompt"
import { ClaudeProvider } from "@opencode/core/plugin/provider/claude-agent/provider"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/schema/agent"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"
import { KiloSoulPlugin } from "../src/soul"
import SOUL from "../src/soul/soul.txt"
import { KiloSubagentDelegationPlugin } from "../src/subagent-delegation"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const code = Agent.ID.make("code")
const model = { providerID: kilo, id: Model.ID.make("anthropic/claude-sonnet-4.6") }
const soul = SystemPart.make(SOUL.trim())

// Starts the plugins in host order: the Gateway, which replaces the first system part with its model template, then
// the persona, which the host registers after the config plugins.
const start = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(kilo, (provider) => {
      provider.integrationID = Integration.ID.make("kilo")
      provider.package = "@opencode/ai/providers/openai-compatible"
      provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
    })
  })
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, "test")
  yield* OptimizePlugin.OpenAIPlugin.effect(host)
  yield* ClaudeInstructions.register(host)
  yield* KiloPlugin.effect(host)
  yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
  yield* KiloSubagentDelegationPlugin.effect(host)
  yield* KiloSoulPlugin.effect(host)
  return host
})

function gateway<A, E, R>(body: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => fixture()),
    (backend) => {
      backend.state.models = {
        data: [
          {
            id: model.id,
            name: "Claude Sonnet",
            context_length: 200000,
            opencode: { family: "claude", ai_sdk_provider: "anthropic" },
          },
          {
            id: "openai/gpt-5.5",
            name: "GPT-5.5",
            context_length: 200000,
            opencode: { family: "gpt", ai_sdk_provider: "openai-compatible", prompt: "gpt55" },
          },
        ],
      }
      return withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_AI_GATEWAY_URL: undefined,
          KILO_API_KEY: "token",
          KILOCODE_TOKEN: undefined,
          KILO_AUTH_CONTENT: undefined,
          KILO_ORG_ID: undefined,
        },
        () => body,
      )
    },
    (backend) => Effect.sync(() => backend[Symbol.dispose]()),
  )
}

describe("Kilo persona", () => {
  it.live("leads agent, compaction and generate requests, ahead of the Gateway model template", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        yield* host.agent.transform((editor) => editor.update("code", (agent) => void (agent.system = undefined)))
        const session = yield* host.session.create({ title: "Persona" })
        const hooks = yield* PluginHooks.Service
        const input = {
          sessionID: session.id,
          agent: code,
          model,
          system: [SystemPart.make("BASE"), SystemPart.make("INSTRUCTIONS")],
          messages: [],
          options: {},
          tools: {},
        }
        // A generate request replays the agent's prompt, so it carries the same parts as an agent step.
        for (const name of ["context", "compaction", "generate"] as const) {
          const request = yield* hooks.trigger("session", name, structuredClone(input))
          expect(request.system[0]).toEqual(soul)
          // The Gateway replaced the template part, not the persona.
          expect(request.system[1]?.text).toContain("# Code comments")
          expect(request.system[1]?.text).not.toContain("BASE")
          expect(request.system.slice(2)).toEqual([SystemPart.make("INSTRUCTIONS")])
          expect(request.system.filter((part) => part.text === soul.text)).toHaveLength(1)
        }
      }),
    ),
  )

  it.live("leads an agent's own system prompt", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        yield* host.agent.transform((editor) => editor.update("code", (agent) => void (agent.system = "CUSTOM")))
        const session = yield* host.session.create({ title: "Persona" })
        const hooks = yield* PluginHooks.Service
        const request = yield* hooks.trigger("session", "context", {
          sessionID: session.id,
          agent: code,
          model,
          system: [SystemPart.make("CUSTOM")],
          messages: [],
          options: {},
          tools: {},
        })
        expect(request.system).toEqual([soul, SystemPart.make("CUSTOM")])
      }),
    ),
  )

  it.live("is left out of title requests", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        const session = yield* host.session.create({ title: "Persona" })
        const hooks = yield* PluginHooks.Service
        const request = yield* hooks.trigger("session", "title", {
          sessionID: session.id,
          model,
          system: [SystemPart.make("TITLE")],
          messages: [],
          options: {},
        })
        expect(request.system).toEqual([SystemPart.make("TITLE")])
      }),
    ),
  )
})

describe("Kilo delegation", () => {
  const tool = { description: "Tool", input: { type: "object" } } as const

  it.live("prefers background delegation across model templates without carrying the upstream opt-in rule", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        yield* host.agent.transform((editor) => editor.update("code", (agent) => void (agent.system = undefined)))
        const session = yield* host.session.create({ title: "Delegation" })
        const hooks = yield* PluginHooks.Service
        const input = {
          sessionID: session.id,
          agent: code,
          messages: [],
          options: {},
          tools: { subagent: tool },
        }

        for (const [selection, expected] of [
          [{ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-6.2-sol") }, "# Destructive actions"],
          [{ providerID: kilo, id: Model.ID.make("openai/gpt-5.5") }, "# Editing and verification"],
          [model, "# Code comments"],
          [{ providerID: Provider.ID.make("other"), id: Model.ID.make("unknown") }, "BASE"],
        ] as const) {
          const request = yield* hooks.trigger("session", "context", {
            ...input,
            model: selection,
            system: [SystemPart.make("BASE"), SystemPart.make("PROJECT INSTRUCTIONS")],
          })
          expect(request.system[0]).toEqual(soul)
          expect(request.system[1]?.text).toContain(expected)
          expect(request.system[1]?.text).not.toContain("Do not spawn subagents unless")
          expect(request.system[2]?.text).toBe("PROJECT INSTRUCTIONS")
          expect(request.system[3]?.text).toContain("without waiting for an explicit request")
          expect(request.system[3]?.text).toContain("Prefer background subagents")
          expect(request.system[3]?.text).not.toContain("shared board")
          expect(request.system).toHaveLength(4)
        }
      }),
    ),
  )

  it.live("preserves custom restrictions and only offers delegation where the tool exists", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        const custom = "CUSTOM\n\n# Delegation\n\nDo not spawn subagents unless asked."
        yield* host.agent.transform((editor) => editor.update("code", (agent) => void (agent.system = custom)))
        const session = yield* host.session.create({ title: "Custom delegation" })
        const hooks = yield* PluginHooks.Service
        const input = {
          sessionID: session.id,
          agent: code,
          model,
          messages: [],
          options: {},
        }
        const request = yield* hooks.trigger("session", "context", {
          ...input,
          system: [SystemPart.make(custom)],
          tools: { subagent: tool, board_read: tool, board_post: tool },
        })
        expect(request.system[1]?.text).toBe(custom)
        expect(request.system[2]?.text).toContain("Prefer background subagents")
        expect(request.system[2]?.text).not.toContain("shared board")

        const withoutSubagent = yield* hooks.trigger("session", "context", {
          ...input,
          system: [SystemPart.make(custom)],
          tools: { board_read: tool, board_post: tool },
        })
        expect(withoutSubagent.system).toEqual([soul, SystemPart.make(custom)])
      }),
    ),
  )

  it.live("applies the same template and policy to compaction and generate requests", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        yield* host.agent.transform((editor) => editor.update("code", (agent) => void (agent.system = undefined)))
        const session = yield* host.session.create({ title: "Delegation request kinds" })
        const hooks = yield* PluginHooks.Service
        const input = {
          sessionID: session.id,
          agent: code,
          model: { providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-6.2-sol") },
          messages: [],
          options: {},
          tools: { subagent: tool },
        }
        for (const name of ["compaction", "generate"] as const) {
          const request = yield* hooks.trigger("session", name, { ...input, system: [SystemPart.make("BASE")] })
          expect(request.system[1]?.text).toContain("# Destructive actions")
          expect(request.system[1]?.text).not.toContain("Do not spawn subagents unless")
          expect(request.system.at(-1)?.text).toContain("Prefer background subagents")
        }
        const withoutTools = yield* hooks.trigger("session", "generate", {
          ...input,
          system: [SystemPart.make("BASE")],
          tools: {},
        })
        expect(withoutTools.system[1]?.text).toContain("# Destructive actions")
        expect(withoutTools.system[1]?.text).not.toContain("Do not spawn subagents unless")
        expect(withoutTools.system).toHaveLength(2)
      }),
    ),
  )

  it.live("passes the same guidance through the Claude Agent driver's instruction option", () =>
    gateway(
      Effect.gen(function* () {
        const host = yield* start()
        yield* host.agent.transform((editor) => editor.update("code", (agent) => void (agent.system = undefined)))
        const session = yield* host.session.create({ title: "Claude Agent delegation" })
        const hooks = yield* PluginHooks.Service
        const input: SessionContext = {
          sessionID: session.id,
          agent: code,
          model: { providerID: ClaudeProvider.ID, id: model.id },
          system: [SystemPart.make("BASE"), SystemPart.make("PROJECT INSTRUCTIONS")],
          messages: [],
          options: {},
          tools: { subagent: tool },
        }
        const request = yield* hooks.trigger("session", "context", input)
        expect(request.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION]).toStartWith("PROJECT INSTRUCTIONS\n\n")
        expect(request.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION]).toContain("Prefer background subagents")
      }),
    ),
  )
})
