// Data of the Kilo sidebar usage panel. Same rules as v1 (packages/opencode/src/kilocode/session/model-usage.ts and
// packages/opencode/src/kilocode/plugins/model-usage.ts on main): one row per provider and model over the completed
// steps of the session family, keyed by the routed model of each step, sorted by cost.
import type { SessionMessageInfo } from "@opencode/client"
import { routedModel } from "../routed-model"

type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }

export type ModelUsage = { providerID: string; modelID: string; steps: number; cost: number; tokens: Tokens }

/** One v2 assistant message is one step. A step counts when it has token usage, as a v1 step-finish part. */
export function modelUsage(messages: readonly SessionMessageInfo[]) {
  const rows = new Map<string, ModelUsage>()
  messages.forEach((message) => {
    if (message.type !== "assistant" || !message.tokens) return
    const model = routedModel(message) ?? message.model
    const key = `${model.providerID}/${model.id}`
    const row = rows.get(key) ?? { providerID: model.providerID, modelID: model.id, steps: 0, cost: 0, tokens: empty() }
    rows.set(key, {
      ...row,
      steps: row.steps + 1,
      cost: row.cost + Math.max(0, message.cost ?? 0),
      tokens: sum(row.tokens, message.tokens),
    })
  })
  const models = [...rows.values()].toSorted(
    (a, b) => b.cost - a.cost || a.providerID.localeCompare(b.providerID) || a.modelID.localeCompare(b.modelID),
  )
  const totals = models.reduce(
    (total, row) => ({
      steps: total.steps + row.steps,
      cost: total.cost + row.cost,
      tokens: sum(total.tokens, row.tokens),
    }),
    { steps: 0, cost: 0, tokens: empty() },
  )
  return { totals, models }
}

/** Groups the rows by provider in row order, with the provider name when the provider list has it. */
export function groupModelsByProvider(
  models: readonly ModelUsage[],
  providers: ReadonlyArray<{ id: string; name: string }>,
) {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]))
  return [...Map.groupBy(models, (model) => model.providerID)].map(([providerID, rows]) => ({
    providerID,
    providerName: names.get(providerID) ?? providerID,
    models: rows,
  }))
}

/** Cache read share of the prompt tokens, as v1 `formatRate`. */
export function cacheRate(tokens: Tokens) {
  return { input: tokens.input, read: tokens.cache.read, write: tokens.cache.write }
}

function sum(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cache: { read: a.cache.read + b.cache.read, write: a.cache.write + b.cache.write },
  }
}

function empty(): Tokens {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}
