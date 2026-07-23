import type { Config, KiloClient } from "@kilocode/sdk/v2/client"
import { parseModelString } from "../shared/provider-model"
import * as ModelState from "./model-state"

export interface VariantStore {
  get(key: string): unknown
  update(key: string, value: unknown): PromiseLike<void>
}

const pending = new WeakMap<KiloClient, Promise<void>>()

export namespace VariantMigration {
  export function run(store: VariantStore | undefined, client: KiloClient | null, directory?: string): Promise<void> {
    if (!store || !client) return Promise.resolve()
    const existing = pending.get(client)
    if (existing) return existing
    const task = migrate(store, client, directory)
    const done = task.finally(() => {
      if (pending.get(client) === done) pending.delete(client)
    })
    pending.set(client, done)
    return done
  }
}

async function migrate(store: VariantStore, client: KiloClient, directory?: string): Promise<void> {
  const values = entries(store.get("variantSelections"))
  if (Object.keys(values).length === 0) return

  const { data: config } = await client.global.config.get({ throwOnError: true })
  if (!config) return

  const [models, agents] = await Promise.all([
    ModelState.selections(client),
    client.app.agents(directory ? { directory } : undefined),
  ])
  const matches: Array<[string, string]> = []
  const next: NonNullable<Config["agent"]> = {}
  const global = parseModelString(config.model) ?? undefined

  for (const agent of agents.data ?? []) {
    const current = config.agent?.[agent.name]
    const selected = models[agent.name] ?? parseModelString(current?.model) ?? global
    if (!selected) continue

    const scoped = `agent/${agent.name}/${key(selected)}`
    const plain = key(selected)
    const value = values[scoped] ?? values[plain]
    const id = values[scoped] === undefined ? plain : scoped
    if (value === undefined) continue

    if (current?.variant !== undefined) continue
    next[agent.name] = { variant: value }
    matches.push([id, value])
  }

  if (Object.keys(next).length === 0) return

  await client.global.config.update({ config: { agent: next } }, { throwOnError: true })

  await clean(store, matches)
}

async function clean(store: VariantStore, matches: Array<[string, string]>): Promise<void> {
  const latest = store.get("variantSelections")
  if (!record(latest)) return

  const cleaned = { ...latest }
  let changed = false
  for (const [key, value] of matches) {
    if (cleaned[key] !== value) continue
    delete cleaned[key]
    changed = true
  }
  if (changed) await store.update("variantSelections", cleaned)
}

function entries(input: unknown): Record<string, string> {
  if (!record(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((item): item is [string, string] => typeof item[1] === "string"),
  )
}

function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

function key(model: { providerID: string; modelID: string }) {
  return `${model.providerID}/${model.modelID}`
}
