export * as KiloSessionUsage from "./usage.js"

import type { ProviderMetadata, Usage } from "@opencode/ai"
import { Money } from "@opencode/schema/money"
import { sql } from "drizzle-orm"

export const modelID = sql`CASE
  WHEN json_extract(message.data, '$.model.providerID') = 'kilo'
    AND json_type(message.data, '$.native.kilo.routedModelID') = 'text'
  THEN coalesce(nullif(trim(json_extract(message.data, '$.native.kilo.routedModelID')), ''), json_extract(message.data, '$.model.id'))
  ELSE json_extract(message.data, '$.model.id')
END`

// The raw usage escape hatch differs by transport; normalized OpenRouter metadata takes precedence.
export function providerCost(usage: Usage | undefined, providerID?: string, metadata?: ProviderMetadata) {
  if (providerID !== "kilo") return undefined
  const raw = Object.values(usage?.providerMetadata ?? {})
  const openrouter = record(metadata?.openrouter?.usage) ?? usage?.providerMetadata?.openrouter
  if (openrouter) {
    const upstream =
      number(record(openrouter.costDetails)?.upstreamInferenceCost) ??
      number(record(openrouter.cost_details)?.upstream_inference_cost)
    if (upstream !== undefined) return Money.USD.make(Math.max(0, upstream))
    const regular = number(openrouter.cost)
    if (regular !== undefined) return Money.USD.make(Math.max(0, regular))
  }
  const upstream = raw
    .map((value) => number(record(value.cost_details)?.upstream_inference_cost))
    .find((value) => value !== undefined)
  if (upstream !== undefined) return Money.USD.make(Math.max(0, upstream))
  const market =
    number(metadata?.gateway?.marketCost) ??
    raw.map((value) => number(record(value.gateway)?.marketCost)).find((value) => value !== undefined)
  return market === undefined ? undefined : Money.USD.make(Math.max(0, market))
}

// Persist only response identity. Settled cost and normalized tokens already have durable fields.
export function native(usage: Usage | undefined, providerID: string, native?: Record<string, unknown>) {
  if (providerID !== "kilo") return native
  const raw = Object.values(usage?.providerMetadata ?? {})
  const routedModelID = raw.map((value) => value.routedModelID).find((value) => typeof value === "string")
  const vercelID = raw.map((value) => value.vercelID).find((value) => typeof value === "string")
  const generationID = raw.map((value) => value.generationID).find((value) => typeof value === "string")
  const responseID = raw.map((value) => value.responseID).find((value) => typeof value === "string")
  if (routedModelID === undefined && vercelID === undefined && generationID === undefined && responseID === undefined)
    return native
  return {
    ...native,
    kilo: {
      ...(routedModelID === undefined ? {} : { routedModelID }),
      ...(vercelID === undefined ? {} : { vercelID }),
      ...(generationID === undefined ? {} : { generationID }),
      ...(responseID === undefined ? {} : { responseID }),
    },
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function number(value: unknown) {
  if (value === undefined || value === null) return undefined
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined
}
