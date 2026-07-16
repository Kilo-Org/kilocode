import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider"
import { wrapLanguageModel } from "ai"
import { z } from "zod"

type Part = Awaited<ReturnType<LanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never

const dataSchema = z.record(z.string(), z.json())
const attemptSchema = z
  .object({
    canonicalSlug: z.string().optional(),
    success: z.boolean().optional(),
  })
  .catchall(z.json())
const routingSchema = z
  .object({
    canonicalSlug: z.string().optional(),
    modelAttempts: z.array(attemptSchema).optional(),
  })
  .catchall(z.json())
const gatewaySchema = z
  .object({
    routing: routingSchema.optional(),
  })
  .catchall(z.json())
const metadataSchema = z.object({ gateway: gatewaySchema.optional() })
const rawEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message_start"),
    provider_metadata: metadataSchema.optional(),
    message: z.object({
      model: z.string().optional(),
      usage: dataSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("message_delta"),
    provider_metadata: metadataSchema.optional(),
    usage: dataSchema.optional(),
  }),
  z.object({
    type: z.enum(["response.completed", "response.incomplete"]),
    provider_metadata: metadataSchema.optional(),
    response: z.object({
      model: z.string().optional(),
      usage: dataSchema.optional(),
      provider_metadata: metadataSchema.optional(),
    }),
  }),
])

type Gateway = z.infer<typeof gatewaySchema>
type Data = z.infer<typeof dataSchema>

function routed(meta: Gateway) {
  const route = meta.routing
  if (!route) return
  const hit = route.modelAttempts?.reduceRight<(typeof route.modelAttempts)[number] | undefined>(
    (found, item) => found ?? (item.success === true ? item : undefined),
    undefined,
  )
  const id = hit?.canonicalSlug ?? route.canonicalSlug
  if (!id) return
  const value = id.trim()
  return value || undefined
}

function event(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") return {}
  const type = Reflect.get(value, "type")
  if (
    type !== "message_start" &&
    type !== "message_delta" &&
    type !== "response.completed" &&
    type !== "response.incomplete"
  )
    return {}

  const result = rawEventSchema.safeParse(value)
  if (!result.success) return {}
  const item = result.data
  switch (item.type) {
    case "message_start":
      return {
        meta: item.provider_metadata?.gateway,
        usage: item.message.usage,
        model: item.message.model?.trim() || undefined,
        terminal: false,
      }
    case "message_delta":
      return { meta: item.provider_metadata?.gateway, usage: item.usage, terminal: false }
    case "response.completed":
    case "response.incomplete":
      return {
        meta: item.provider_metadata?.gateway ?? item.response.provider_metadata?.gateway,
        usage: item.response.usage,
        model: item.response.model?.trim() || undefined,
        terminal: true,
      }
  }
}

export function wrap(input: LanguageModelV3): LanguageModelV3 {
  return wrapLanguageModel({
    model: input,
    middleware: {
      specificationVersion: "v3",
      async wrapStream({ model, params }) {
        const result = await model.doStream({ ...params, includeRawChunks: true })
        const chunks = params.includeRawChunks === true
        let meta: Gateway | undefined
        let usage: Data | undefined
        let initial: string | undefined
        let terminal: string | undefined
        let current: string | undefined

        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream<Part, Part>({
              transform(part, controller) {
                if (part.type === "raw") {
                  const info = event(part.rawValue)
                  meta = info.meta ?? meta
                  usage = info.usage ? { ...usage, ...info.usage } : usage
                  if (info.model) {
                    if (info.terminal) terminal = info.model
                    else initial = info.model
                  }
                  if (chunks) controller.enqueue(part)
                  return
                }
                if (part.type === "response-metadata") current = part.modelId ?? current
                if (part.type !== "finish") {
                  controller.enqueue(part)
                  return
                }

                const id = (meta ? routed(meta) : undefined) ?? terminal ?? initial
                if (id && id !== current) controller.enqueue({ type: "response-metadata", modelId: id })
                controller.enqueue({
                  ...part,
                  usage: usage
                    ? {
                        ...part.usage,
                        raw: { ...part.usage.raw, ...usage },
                      }
                    : part.usage,
                  providerMetadata: meta ? { ...part.providerMetadata, gateway: meta } : part.providerMetadata,
                })
              },
            }),
          ),
        }
      },
    },
  })
}
