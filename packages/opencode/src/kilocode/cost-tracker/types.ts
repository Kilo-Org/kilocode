export type { TokenUsage, ModelUsage } from "@kilo-code/boxes/cost-tracker"
export interface CostState {
  totalCostUSD: number
  totalAPIDuration: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  modelUsage: Record<string, import("@kilo-code/boxes/cost-tracker").ModelUsage>
}
