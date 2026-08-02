import type { Provider } from "@/provider/provider"

const EFFORTS = ["low", "high", "max"] as const
const MODEL = /(?:^|\/)kimi-k3(?:$|[-/:])/i

export function kimiK3Variants(model: Provider.Model, variants: Record<string, Record<string, any>>) {
  if (![model.id, model.api.id].some((id) => MODEL.test(id))) return variants

  const low = variants.low
  const high = variants.high
  if (low?.reasoningEffort !== "low" || high?.reasoningEffort !== "high") return variants

  return Object.fromEntries(
    EFFORTS.map((effort) => [
      effort,
      { ...(effort === "low" ? low : (variants[effort] ?? high)), reasoningEffort: effort },
    ]),
  )
}
