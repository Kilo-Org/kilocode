import { t } from "./shims/i18n"

export function humanFormatSessionCost(cost: number): string {
  if (cost === 0) {
    return t("kilocode:autocomplete.statusBar.cost.zero")
  }
  if (cost > 0 && cost < 0.01) {
    return t("kilocode:autocomplete.statusBar.cost.lessThanCent")
  }
  return `$${cost.toFixed(2)}`
}
