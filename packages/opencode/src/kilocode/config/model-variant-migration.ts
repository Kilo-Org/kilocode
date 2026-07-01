import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
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
  export const MIGRATION_ID = "agentVariantConfigV1"
  export const MARKER_FILE = path.join(Global.Path.state, "kilocode-migrations.json")

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
      used.add(id)
      if (isRecord(item) && item.variant !== undefined) continue
      agent[name] = { variant: value }
    }

    return {
      patch: Object.keys(agent).length > 0 ? ({ agent } as Config.Info) : ({} as Config.Info),
      used,
      remaining: Object.fromEntries(Object.entries(state.variant).filter(([id]) => !used.has(id))),
    }
  }

  export function run(input: Input) {
    return Effect.gen(function* () {
      const marker = target("kilocode-migrations.json")
      const done = yield* Effect.tryPromise(() => markerDone(marker)).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("failed to read migration marker", { err })
            return false
          }),
        ),
      )
      if (done) return

      const file = target("model.json")
      const state = yield* Effect.tryPromise(() => read(file)).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("failed to read model state", { err })
            return {}
          }),
        ),
      )
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
        const cleaned = yield* Effect.tryPromise(() => cleanup(file, planned.used)).pipe(
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

      yield* Effect.tryPromise(() => writeMarker(marker))
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

async function cleanup(file: string, used: Set<string>) {
  const latest = await read(file)
  if (!isRecord(latest)) return
  const remaining = Object.fromEntries(Object.entries(variants(latest.variant)).filter(([id]) => !used.has(id)))
  const next = { ...latest }
  if (Object.keys(remaining).length > 0) next.variant = remaining
  else delete next.variant
  await Filesystem.writeJson(file, next)
}

async function markerDone(file: string) {
  if (!(await Bun.file(file).exists())) return false
  const marker = await Filesystem.readJson(file)
  return isRecord(marker) && KilocodeModelVariantMigration.MIGRATION_ID in marker
}

async function writeMarker(file: string) {
  const existing = await Filesystem.readJson(file).catch(() => ({}))
  const marker = isRecord(existing) ? existing : {}
  await Filesystem.writeJson(file, {
    ...marker,
    [KilocodeModelVariantMigration.MIGRATION_ID]: InstallationVersion,
  })
}
