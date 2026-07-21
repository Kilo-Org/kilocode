import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { KilocodeModelState } from "@/kilocode/config/model-state"
import { Context, Effect, Layer, Schema } from "effect"
import { CloudAuth } from "./auth"
import { CloudCatalog } from "./catalog"
import { ModelSchema, ModeSchema } from "./contracts"

export namespace CloudDefaults {
  const COMPATIBLE = new Set(["code", "plan", "debug", "orchestrator", "ask", "build", "architect"])

  export type ModelStateInfo = KilocodeModelState.State

  export interface ModelStateInterface {
    readonly get: () => Effect.Effect<ModelStateInfo>
  }

  export class ModelState extends Context.Service<ModelState, ModelStateInterface>()("@kilocode/CloudModelState") {}

  export const modelStateLayer = Layer.succeed(
    ModelState,
    ModelState.of({ get: () => Effect.promise(() => KilocodeModelState.get()) }),
  )

  export interface Input {
    readonly env?: CloudAuth.Environment
    readonly mode?: string
    readonly model?: string
    readonly orgID?: string
  }

  export interface Resolved extends CloudAuth.Resolved {
    readonly mode: string
    readonly model: string
  }

  export class ResolutionError extends Schema.TaggedErrorClass<ResolutionError>()("CloudDefaultsResolutionError", {
    kind: Schema.Literals(["mode", "model"]),
    message: Schema.String,
  }) {}

  const mode = Effect.fn("CloudDefaults.mode")(function* (value: string | undefined, fallback: string | undefined) {
    const service = yield* Agent.Service
    if (value !== undefined) {
      if (!ModeSchema.safeParse(value).success || !COMPATIBLE.has(value)) {
        return yield* Effect.fail(
          new ResolutionError({
            kind: "mode",
            message: `Cloud Agent mode is unavailable: ${value}`,
          }),
        )
      }
      const info = yield* service.get(value)
      if (info && (info.mode === "subagent" || info.hidden === true)) {
        return yield* Effect.fail(
          new ResolutionError({
            kind: "mode",
            message: `Cloud Agent mode is unavailable: ${value}`,
          }),
        )
      }
      return { name: value, info }
    }

    const info = yield* service.get(fallback ?? "code")
    if (info && COMPATIBLE.has(info.name) && info.mode !== "subagent" && info.hidden !== true) {
      return { name: info.name, info }
    }
    const base = yield* service.get("code")
    if (base && (base.mode === "subagent" || base.hidden === true)) {
      return yield* Effect.fail(
        new ResolutionError({
          kind: "mode",
          message: "Cloud Agent mode is unavailable: code",
        }),
      )
    }
    return { name: "code", info: base }
  })

  function ref(value: { readonly providerID: string; readonly modelID: string } | undefined) {
    return value ? `${value.providerID}/${value.modelID}` : undefined
  }

  function normalize(value: string) {
    return value.startsWith("kilo/") ? value.slice("kilo/".length) : value
  }

  export const resolve = Effect.fn("CloudDefaults.resolve")(function* (input: Input = {}) {
    const auth = yield* CloudAuth.resolve({ orgID: input.orgID, env: input.env })
    const config = yield* Config.Service
    const cfg = yield* config.get()
    const selected = yield* mode(input.mode, cfg.default_agent ?? undefined)
    const states = yield* ModelState
    const saved = yield* states.get()
    const catalog = yield* CloudCatalog.Service
    const available = new Set(yield* catalog.models(auth))

    if (input.model !== undefined) {
      const explicit = normalize(input.model)
      if (!ModelSchema.safeParse(explicit).success || !available.has(explicit)) {
        return yield* Effect.fail(
          new ResolutionError({
            kind: "model",
            message: `Cloud Agent model is unavailable: ${input.model}`,
          }),
        )
      }
      return { ...auth, mode: selected.name, model: explicit } satisfies Resolved
    }

    const candidates = [
      ref(selected.info?.model),
      ref(saved.model[selected.name]),
      cfg.model ?? undefined,
      ...saved.recent.map(ref),
    ]
    for (const value of candidates) {
      if (!value) continue
      const candidate = normalize(value)
      if (!ModelSchema.safeParse(candidate).success) continue
      if (!available.has(candidate)) continue
      return { ...auth, mode: selected.name, model: candidate } satisfies Resolved
    }

    const fallback = normalize(yield* catalog.defaultModel(auth))
    if (ModelSchema.safeParse(fallback).success && available.has(fallback)) {
      return { ...auth, mode: selected.name, model: fallback } satisfies Resolved
    }

    return yield* Effect.fail(
      new ResolutionError({
        kind: "model",
        message: "The Kilo model catalog has no available default model",
      }),
    )
  })
}
