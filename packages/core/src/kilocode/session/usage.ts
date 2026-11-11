export * as KiloSessionUsage from "./usage.js"

import type { Usage } from "@opencode/ai/effect"
import { Money } from "@opencode/schema/money"
import { sql } from "drizzle-orm"

export const modelID = sql`CASE
  WHEN json_extract(message.data, '$.model.providerID') = 'kilo'
    AND json_type(message.data, '$.native.kilo.routedModelID') = 'text'
  THEN coalesce(nullif(trim(json_extract(message.data, '$.native.kilo.routedModelID')), ''), json_extract(message.data, '$.model.id'))
  ELSE json_extract(message.data, '$.model.id')
END`

// The Kilo Gateway rewrites `usage.cost` to what it charged, on every dialect. When the call ran on the user's own
// provider key (`is_byok`), the inference cost is `cost_details.upstream_inference_cost` instead.
export function providerCost(usage: Usage | undefined, providerID?: string) {
  if (providerID !== "kilo") return undefined
  const raw = Object.values(usage?.providerMetadata ?? {}).find((value) => "cost" in value || "is_byok" in value)
  const cost = raw?.is_byok === true ? record(raw.cost_details)?.upstream_inference_cost : raw?.cost
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? Money.USD.make(cost) : undefined
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
