import type { Provider } from "@/provider/provider"

const MODEL = /(?:^|\/)kimi-k3(?:$|[-/:])/i

export function kimiK3Variants(model: Provider.Model, variants: Record<string, Record<string, any>>) {
  if (![model.id, model.api.id].some((id) => MODEL.test(id))) return variants

  const low = variants.low
  const high = variants.high
  if (low?.reasoningEffort !== "low" || high?.reasoningEffort !== "high") return variants

  const { medium: _, ...supported } = variants
  return {
    ...supported,
    max: { ...(variants.max ?? high), reasoningEffort: "max" },
  }
}
