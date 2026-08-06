import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import { matchesQuery } from "./model-search"
import DESCRIPTION from "./agent-manager-models.txt"

const Params = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "Case-insensitive search across model names and IDs (e.g. 'opus', 'glm 5.2')",
  }),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Result offset for pagination (default 0)",
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "Maximum models to return (default 20; hard-capped at 20 to keep output small)",
  }),
})

const MAX_LIMIT = 20

type Entry = {
  name: string
  providers: string[]
  variants: string[]
  ids: string[]
  rank: number
}

// Group models by display name so the agent picks a model, not a provider.
// The same model is often offered by several providers under different IDs;
// agent_manager resolves which provider to actually use at launch time.
function entries(providers: Record<ProviderV2.ID, Provider.Info>): Entry[] {
  const byName = new Map<string, Entry>()
  for (const provider of Object.values(providers)) {
    for (const model of Object.values(provider.models)) {
      const entry = byName.get(model.name) ?? {
        name: model.name,
        providers: [],
        variants: [],
        ids: [],
        rank: Number.POSITIVE_INFINITY,
      }
      if (!entry.providers.includes(provider.id)) entry.providers.push(provider.id)
      entry.ids.push(`${provider.id}/${model.id}`)
      for (const variant of Object.keys(model.variants ?? {})) {
        if (!entry.variants.includes(variant)) entry.variants.push(variant)
      }
      const index = typeof model.recommendedIndex === "number" ? model.recommendedIndex : Number.POSITIVE_INFINITY
      entry.rank = Math.min(entry.rank, index)
      byName.set(model.name, entry)
    }
  }
  return [...byName.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
}

function view(entry: Entry) {
  return { name: entry.name, providers: entry.providers, variants: entry.variants }
}

export const AgentManagerModelsTool = Tool.define<
  typeof Params,
  { count: number; total: number },
  Provider.Service,
  "agent_manager_models"
>(
  "agent_manager_models",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params) =>
        Effect.gen(function* () {
          const providers = yield* provider.list()
          const all = entries(providers)
          const query = params.query?.trim()
          const matches = query ? all.filter((entry) => matchesQuery([entry.name, ...entry.ids], query)) : all
          const offset = params.offset ?? 0
          const limit = Math.min(params.limit ?? MAX_LIMIT, MAX_LIMIT)
          const models = matches.slice(offset, offset + limit).map(view)
          const nextOffset = offset + models.length < matches.length ? offset + models.length : undefined
          return {
            title: query
              ? `${matches.length} model${matches.length === 1 ? "" : "s"} matching "${params.query?.trim()}"`
              : `${matches.length} available models`,
            output: JSON.stringify({
              models,
              offset,
              total: matches.length,
              nextOffset,
              hint: "Pass a model name (or one of its providers/IDs) as the agent_manager task `model`. Agent Manager picks the provider, preferring the one used by the current turn.",
            }),
            metadata: { count: models.length, total: matches.length },
          }
        }),
    }
  }),
)
