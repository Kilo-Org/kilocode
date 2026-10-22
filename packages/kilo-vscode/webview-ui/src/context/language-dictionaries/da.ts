import { dict as app } from "../../i18n/da"
import { dict as ui } from "@kilocode/kilo-ui/i18n/da"
import { dict as kilo } from "@kilocode/kilo-i18n/da"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Forgren session",
    "agentManager.tab.pin": "Fastgør",
    "agentManager.tab.unpin": "Frigør",
    "agentManager.tab.pinned": "Fastgjort",
    "agentManager.tab.close": "Luk",
    "agentManager.tab.closeOthers": "Luk andre",
    "agentManager.tab.closeToRight": "Luk til højre",
    "agentManager.review.showMore": "Vis {{count}} mere",
    "agentManager.review.showLess": "Vis mindre",
    "agentManager.review.clearAll": "Ryd alle",
    "agentManager.diff.openFile": "Åbn fil",
  }
}
