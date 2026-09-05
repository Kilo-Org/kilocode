import { Effect } from "effect"
import type { MetadataExtractor } from "@ai-sdk/openai-compatible"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { isKiloAutoID, responseModelID, routedModelMetadata } from "./routed-model"

type ExistingMetadataExtractor = Partial<MetadataExtractor>
type ProviderMetadata = NonNullable<Awaited<ReturnType<MetadataExtractor["extractMetadata"]>>>

export const ROUTED_MODEL_PLUGIN_ID = "kilocode.routed-model"
const KILO_OPENAI_COMPATIBLE = "aisdk:@ai-sdk/openai-compatible/kilo"
const KILO_RUNTIME_PACKAGE = "@ai-sdk/openai-compatible/kilo"
const KILO_METADATA_KEY = "openai-compatible/kilo"

/**
 * Captures the gateway's actual response model for Kilo Auto only. The
 * Kilo-owned provider instance carries its runtime-only extractor regardless
 * of built-in SDK hook order.
 */
export function createRoutedModelPlugin() {
  return define({
    id: ROUTED_MODEL_PLUGIN_ID,
    effect: Effect.fn("KiloRoutedModel.effect")(function* (ctx) {
      yield* ctx.catalog.transform((catalog) => {
        for (const record of catalog.provider.list()) {
          if (record.provider.id !== "kilo") continue
          if (record.provider.package !== "aisdk:@ai-sdk/openai-compatible") continue
          for (const model of record.models.values()) {
            if (!isKiloAutoID(model.id)) continue
            catalog.model.update(record.provider.id, model.id, (draft) => {
              if (draft.package !== undefined && draft.package !== "aisdk:@ai-sdk/openai-compatible") return
              draft.package = KILO_OPENAI_COMPATIBLE
            })
          }
        }
      })
      yield* ctx.aisdk.hook(
        "sdk",
        Effect.fn(function* (evt) {
          if (evt.model.providerID !== "kilo") return
          if (evt.package !== KILO_RUNTIME_PACKAGE) return
          if (!isKiloAutoID(evt.model.modelID ?? evt.model.id)) return
          const { createOpenAICompatible } = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
          evt.sdk = createOpenAICompatible({
            ...evt.options,
            // The package alias changes Core's provider-option key. Match it here so source variants still reach the SDK.
            name: KILO_METADATA_KEY,
            metadataExtractor: routedModelExtractor(
              metadataExtractor(evt.options.metadataExtractor),
              KILO_METADATA_KEY,
            ),
          } as Parameters<typeof createOpenAICompatible>[0])
        }),
      )
    }),
  })
}

export function routedModelExtractor(
  existing: ExistingMetadataExtractor | undefined,
  metadataKey = "kilo",
): MetadataExtractor {
  return {
    extractMetadata: async (input) => {
      const metadata = await existing?.extractMetadata?.(input)
      const model = responseModelID(input.parsedBody)
      return model === undefined ? metadata : merge(metadata, model, metadataKey)
    },
    createStreamExtractor: () => {
      const extractor = existing?.createStreamExtractor?.()
      let model: string | undefined
      return {
        processChunk(input) {
          extractor?.processChunk(input)
          model = responseModelID(input) ?? model
        },
        buildMetadata() {
          const metadata = extractor?.buildMetadata()
          return model === undefined ? metadata : merge(metadata, model, metadataKey)
        },
      }
    },
  }
}

function metadataExtractor(input: unknown): ExistingMetadataExtractor | undefined {
  if (!isRecord(input)) return
  if (input.extractMetadata !== undefined && typeof input.extractMetadata !== "function") return
  if (input.createStreamExtractor !== undefined && typeof input.createStreamExtractor !== "function") return
  return input as ExistingMetadataExtractor
}

function merge(input: ProviderMetadata | undefined, model: string, metadataKey: string): ProviderMetadata {
  const existing = input?.[metadataKey]
  return {
    ...input,
    [metadataKey]: { ...(isRecord(existing) ? existing : {}), ...routedModelMetadata(model).kilo },
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
