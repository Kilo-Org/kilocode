export * as ConfigProviderPlugin from "./provider"

import { define } from "../../plugin/internal"
import { Effect } from "effect"
import { Config } from "../../config"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

export const Plugin = define({
  id: "config-provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    yield* ctx.integration.transform(
      Effect.fn(function* (integrations) {
        const files = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
        const configuredIntegrations = new Set(
          files.flatMap((file) =>
            Object.entries(file.info.providers ?? {}).flatMap(([id, provider]) =>
              provider.env === undefined ? [] : [id],
            ),
          ),
        )
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            const integrationID = id
            if (!configuredIntegrations.has(id) && !integrations.get(integrationID)) continue
            integrations.update(integrationID, (integration) => {
              integration.name = item.name ?? integration.name
            })
            if (item.env !== undefined) {
              integrations.method.update({
                integrationID,
                method: { type: "env", names: [...item.env] },
              })
            }
          }
        }
      }),
    )

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const entries = yield* config.entries()
        const files = entries.filter((entry): entry is Config.Document => entry.type === "document")
        const configuredDefault = Config.latest(entries, "model")
        if (configuredDefault !== undefined) {
          const model = ModelV2.parse(configuredDefault)
          catalog.model.default.set(model.providerID, model.modelID)
        }
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            const providerID = ProviderV2.ID.make(id)
            catalog.provider.update(providerID, (provider) => {
               if (item.name !== undefined) provider.name = item.name
               if (item.api !== undefined) provider.api = { ...item.api }
               // kilocode_change start - Kilo: apply provider-level rate limits from config
               if (item.rateLimit !== undefined) {
                 (provider as any).rateLimit = { ...(provider as any).rateLimit, ...item.rateLimit }
               }
               // kilocode_change end
               if (item.request !== undefined) {
                 Object.assign(provider.request.headers, item.request.headers)
                 Object.assign(provider.request.body, item.request.body)
               }
             })
for (const [id, config] of Object.entries(item.models ?? {})) {
              const modelID = ModelV2.ID.make(id)
              catalog.model.update(providerID, modelID, (model) => {
                  if (config.family !== undefined) model.family = config.family
                  if (config.name !== undefined) model.name = config.name
                  if (config.api !== undefined) model.api = { ...model.api, ...config.api }
                  if (config.capabilities !== undefined) {
                    model.capabilities = {
                      tools: config.capabilities.tools,
                      input: [...config.capabilities.input],
                      output: [...config.capabilities.output],
                    }
                  }
                  if (config.request !== undefined) {
                    Object.assign(model.request.headers, config.request.headers)
                    Object.assign(model.request.body, config.request.body)
                    if (config.request.variant !== undefined) model.request.variant = config.request.variant
                  }
                  if (config.variants !== undefined) {
                    for (const variant of config.variants) {
                      let existing = model.variants.find((item) => item.id === variant.id)
                      if (!existing) {
                        existing = {
                          id: variant.id,
                          headers: {},
                          body: {},
                        }
                        model.variants.push(existing)
                      }
                      Object.assign(existing.headers, variant.headers)
                      Object.assign(existing.body, variant.body)
                    }
                  }
                  if (config.cost !== undefined) {
                    model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                      tier: cost.tier && { ...cost.tier },
                      input: cost.input,
                      output: cost.output,
                      cache: {
                        read: cost.cache?.read ?? 0,
                        write: cost.cache?.write ?? 0,
                      },
                    }))
                  }
                  if (config.disabled !== undefined) model.enabled = !config.disabled
                  if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
                  // kilocode_change start - Kilo: merge model-level rate limits from config
                  if (config.rateLimit !== undefined) {
                    (model as any).rateLimit = { ...(model as any).rateLimit, ...config.rateLimit }
                  }
                  // kilocode_change end
                })
             }
          }
        }
      }),
    )
  }),
})
