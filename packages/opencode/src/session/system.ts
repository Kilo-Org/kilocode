import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_GPT55 from "./prompt/kilocode-gpt-5.5.txt" // kilocode_change
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_LING from "./prompt/ling.txt" // kilocode_change

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Reference } from "@opencode-ai/core/reference"

// kilocode_change start
import SOUL from "../kilocode/soul.txt"
import type { EditorContext } from "../kilocode/editor-context"
import { KilocodeSystemPrompt } from "../kilocode/system-prompt"
import { isLing } from "../kilocode/model-match"
// kilocode_change end

// kilocode_change start
export function instructions() {
  return PROMPT_CODEX.trim()
}

export function soul() {
  return SOUL.trim()
}
// kilocode_change end

export function provider(model: Provider.Model) {
  // kilocode_change start
  function prompt() {
    switch (model.prompt) {
      case "anthropic":
        return [PROMPT_ANTHROPIC]
      case "anthropic_without_todo":
        return [PROMPT_DEFAULT]
      case "beast":
        return [PROMPT_BEAST]
      case "codex":
        return [PROMPT_CODEX]
      case "gemini":
        return [PROMPT_GEMINI]
      case "gpt55":
        return [PROMPT_GPT55]
      case "ling":
        return [PROMPT_LING]
      case "trinity":
        return [PROMPT_TRINITY]
    }
    return undefined
  }

  const kilo = prompt()
  if (kilo) return kilo
  // kilocode_change end

  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  if (isLing(model.api.id)) return [PROMPT_LING] // kilocode_change
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model, editorContext?: EditorContext) => Effect.Effect<string[]> // kilocode_change
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const locations = yield* LocationServiceMap

    return Service.of({
      // kilocode_change start
      environment: Effect.fn("SystemPrompt.environment")(function* (
        model: Provider.Model,
        editorContext?: EditorContext,
      ) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          yield* (yield* PluginBoot.Service).wait()
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        return [
          ...KilocodeSystemPrompt.environment({ ctx, model, editor: editorContext }),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
        ].filter((part): part is string => part !== undefined)
      }),
      // kilocode_change end

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer), Layer.provide(LocationServiceMap.layer))

const locationServiceMapNode = LayerNode.make(LocationServiceMap.layer, [])

export const node = LayerNode.make(layer, [Skill.node, locationServiceMapNode])

export * as SystemPrompt from "./system"
