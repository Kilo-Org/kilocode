// kilocode_change - new file
//
// Kilo-specific model-list patching extracted from
// packages/opencode/src/provider/models.ts. Given the cached models.dev
// providers, returns the providers map with Kilo Gateway and Apertis injected
// (or stripped) based on user config and auth.

import { Effect } from "effect"
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { ModelCache } from "@/provider/model-cache"
import { KILO_OPENROUTER_BASE } from "@kilocode/kilo-gateway"
import type { Provider } from "@/provider/models"
import { normalizeKiloBaseURL } from "./normalize-base-url"

export const applyKiloProviders = Effect.fn("Kilo.applyProviders")(function* (cached: Record<string, Provider>) {
  const providers = { ...cached }
  delete providers["kilo"]

  const config = yield* Effect.promise(() => Config.get())
  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
  const kiloAllowed = (!enabled || enabled.has("kilo")) && !disabled.has("kilo")
  const apt = config.provider?.apertis?.options
  const aptBase = apt?.baseURL ?? "https://api.apertis.ai/v1"
  const aptFetch = {
    ...(apt?.baseURL ? { baseURL: apt.baseURL } : {}),
  }

  if (kiloAllowed) {
    const opts = config.provider?.kilo?.options
    const auth = yield* Effect.promise(() => Auth.get("kilo"))
    const org = opts?.kilocodeOrganizationId ?? (auth?.type === "oauth" ? auth.accountId : undefined)
    const base = normalizeKiloBaseURL(opts?.baseURL, org)
    const fetch = {
      ...(base ? { baseURL: base } : {}),
      ...(org ? { kilocodeOrganizationId: org } : {}),
    }
    const [kilo, apertis] = yield* Effect.all(
      [
        Effect.promise(() => ModelCache.fetch("kilo", fetch).catch(() => ({}))),
        providers["apertis"]
          ? Effect.succeed(null)
          : Effect.promise(() => ModelCache.fetch("apertis", aptFetch).catch(() => ({}))),
      ],
      { concurrency: 2 },
    )

    providers["kilo"] = {
      id: "kilo",
      name: "Kilo Gateway",
      env: ["KILO_API_KEY"],
      api: KILO_OPENROUTER_BASE.endsWith("/") ? KILO_OPENROUTER_BASE : `${KILO_OPENROUTER_BASE}/`,
      npm: "@kilocode/kilo-gateway",
      models: kilo,
    }
    if (Object.keys(kilo).length === 0) {
      yield* Effect.sync(() => void ModelCache.refresh("kilo", fetch).catch(() => {}))
    }
    if (!providers["apertis"] && apertis !== null) {
      providers["apertis"] = {
        id: "apertis",
        name: "Apertis",
        env: ["APERTIS_API_KEY"],
        api: aptBase,
        npm: "@ai-sdk/openai-compatible",
        models: apertis,
      }
      if (Object.keys(apertis).length === 0) {
        yield* Effect.sync(() => void ModelCache.refresh("apertis", aptFetch).catch(() => {}))
      }
    }
    return providers
  }

  if (!providers["apertis"]) {
    const apertis = yield* Effect.promise(() => ModelCache.fetch("apertis", aptFetch).catch(() => ({})))
    providers["apertis"] = {
      id: "apertis",
      name: "Apertis",
      env: ["APERTIS_API_KEY"],
      api: aptBase,
      npm: "@ai-sdk/openai-compatible",
      models: apertis,
    }
    if (Object.keys(apertis).length === 0) {
      yield* Effect.sync(() => void ModelCache.refresh("apertis", aptFetch).catch(() => {}))
    }
  }
  return providers
})
