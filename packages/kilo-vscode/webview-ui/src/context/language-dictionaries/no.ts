import { dict as app } from "../../i18n/no"
import { dict as ui } from "@kilocode/kilo-ui/i18n/no"
import { dict as kilo } from "@kilocode/kilo-i18n/no"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Forgrein økt",
    "agentManager.tab.pin": "Fest",
    "agentManager.tab.unpin": "Løsne",
    "agentManager.tab.pinned": "Festet",
    "agentManager.tab.close": "Lukk",
    "agentManager.tab.closeOthers": "Lukk andre",
    "agentManager.tab.closeToRight": "Lukk til høyre",
    "agentManager.review.showMore": "Vis {{count}} flere",
    "agentManager.review.showLess": "Vis færre",
    "agentManager.review.clearAll": "Fjern alle",
    "agentManager.diff.openFile": "Åpne fil",
  }
}
