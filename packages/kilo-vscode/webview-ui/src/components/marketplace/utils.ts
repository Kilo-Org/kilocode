// Pure helpers of the Marketplace view: the shared record/join/filter rules, plus the labels the cards and filters use.
import type { MarketplaceKind, MarketplaceRecord } from "../../v2/marketplace-data"

export {
  entryKey,
  filterItems,
  filterOrphans,
  mergeParameters,
  needsRepair,
  optionFor,
  orphanRecords,
  prerequisitesFor,
  recordsFor,
  retain,
} from "../../v2/marketplace-data"

export function label(category: string) {
  return category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function kindLabel(t: (key: string) => string, kind: MarketplaceKind) {
  if (kind === "mcp") return t("marketplace.badge.mcpServer")
  if (kind === "agent") return t("marketplace.remove.type.agent")
  return t("marketplace.remove.type.skill")
}

export function statusLabel(t: (key: string) => string, record: MarketplaceRecord) {
  if (record.recovering) return t("marketplace.status.recovering")
  return t(`marketplace.status.${record.status ?? "incomplete"}`)
}
