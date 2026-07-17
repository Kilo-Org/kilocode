import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { Effect } from "effect"
import type { Config } from "@/config/config"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"

const log = Log.create({ service: "model-variant-migration" })

type Model = {
  providerID: string
  modelID: string
}

type State = {
  model: Record<string, Model>
  variant: Record<string, string>
}

type Input = {
  config: Config.Info
  update: (config: Config.Info, options?: { dispose?: boolean }) => Effect.Effect<{ info: Config.Info; changed: boolean }, unknown>
}

export namespace KilocodeModelVariantMigration {
  export function plan(input: { state: unknown; config: Config.Info }) {
    const state = clean(input.state)
    const used = new Set<string>()
    const agent: Record<string, { variant: string }> = {}
    const cfg = agents(input.config)
    const names = new Set([...Object.keys(state.model), ...Object.keys(cfg)])

    for (const name of names) {
      const item = cfg[name]
      const model = configured(item) ?? state.model[name]
      if (!model) continue
      const id = key(model)
      const value = state.variant[id]
      if (!value) continue
      if (isRecord(item) && item.variant !== undefined) continue
      used.add(id)
      agent[name] = { variant: value }
    }

    return {
      patch: Object.keys(agent).length > 0 ? ({ agent } as Config.Info) : ({} as Config.Info),
      used,
      remaining: Object.fromEntries(Object.entries(state.variant).filter(([id]) => !used.has(id))),
      variant: state.variant,
    }
  }

  export function run(input: Input) {
    return Effect.gen(function* () {
      const file = target("model.json")
      const state = yield* Effect.tryPromise(() => read(file))
      const planned = plan({ state, config: input.config })

      if (Object.keys(planned.patch).length > 0) {
        const updated = yield* input.update(planned.patch, { dispose: false }).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) =>
              Effect.sync(() => {
                log.warn("failed to update global config", { cause })
                return false
              }),
            onSuccess: () => Effect.succeed(true),
          }),
        )
        if (!updated) {
          return
        }
      }

      if (planned.used.size > 0) {
        const cleaned = yield* Effect.tryPromise(() => cleanup(file, planned.used, planned.variant)).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) =>
              Effect.sync(() => {
                log.warn("failed to clean model state", { cause })
                return false
              }),
            onSuccess: () => Effect.succeed(true),
          }),
        )
        if (!cleaned) {
          return
        }
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          log.warn("failed to run migration", { cause })
        }),
      ),
    )
  }
}

function target(name: string) {
  return path.join(Global.Path.state, name)
}

function key(model: Model) {
  return `${model.providerID}/${model.modelID}`
}

function agents(config: Config.Info) {
  if (!isRecord(config.agent)) return {}
  return config.agent
}

function configured(input: unknown): Model | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.model !== "string") return undefined
  const [providerID, ...rest] = input.model.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

async function read(file: string) {
  if (!(await Bun.file(file).exists())) return {}
  return Filesystem.readJson(file)
}

function clean(input: unknown): State {
  if (!isRecord(input)) return { model: {}, variant: {} }
  return {
    model: models(input.model),
    variant: variants(input.variant),
  }
}

function models(input: unknown) {
  if (!isRecord(input)) return {}
  return Object.fromEntries(
    Object.entries(input).flatMap(([name, value]) => {
      if (!isRecord(value)) return []
      if (typeof value.providerID !== "string" || typeof value.modelID !== "string") return []
      return [[name, { providerID: value.providerID, modelID: value.modelID }]]
    }),
  )
}

function variants(input: unknown) {
  if (!isRecord(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((item): item is [string, string] => typeof item[1] === "string"),
  )
}

async function cleanup(file: string, used: Set<string>, observed: Record<string, string>) {
  return Flock.withLock(lock(file), async () => {
    const latest = await read(file)
    if (!isRecord(latest) || !isRecord(latest.variant)) return
    const variant = Object.fromEntries(
      Object.entries(latest.variant).filter(([id, value]) => !used.has(id) || value !== observed[id]),
    )
    if (Object.keys(variant).length === Object.keys(latest.variant).length) return
    const next = { ...latest }
    if (Object.keys(variant).length > 0) next.variant = variant
    else delete next.variant
    await Filesystem.writeJson(file, next)
  })
}

function lock(file: string) {
  return `model-state:${file}`
}
