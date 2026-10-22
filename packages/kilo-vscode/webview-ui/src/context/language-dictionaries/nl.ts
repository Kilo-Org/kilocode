import { dict as app } from "../../i18n/nl"
import { dict as ui } from "@kilocode/kilo-ui/i18n/nl"
import { dict as kilo } from "@kilocode/kilo-i18n/nl"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Sessie forken",
    "agentManager.tab.pin": "Vastmaken",
    "agentManager.tab.unpin": "Losmaken",
    "agentManager.tab.pinned": "Vastgemaakt",
    "agentManager.tab.close": "Sluiten",
    "agentManager.tab.closeOthers": "Andere sluiten",
    "agentManager.tab.closeToRight": "Rechts sluiten",
    "agentManager.review.showMore": "{{count}} meer weergeven",
    "agentManager.review.showLess": "Minder weergeven",
    "agentManager.review.clearAll": "Alles wissen",
    "agentManager.diff.openFile": "Bestand openen",
  }
}
