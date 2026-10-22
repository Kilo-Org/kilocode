import { dict as app } from "../../i18n/de"
import { dict as ui } from "@kilocode/kilo-ui/i18n/de"
import { dict as kilo } from "@kilocode/kilo-i18n/de"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Sitzung verzweigen",
    "agentManager.tab.pin": "Anheften",
    "agentManager.tab.unpin": "Lösen",
    "agentManager.tab.pinned": "Angeheftet",
    "agentManager.tab.close": "Schließen",
    "agentManager.tab.closeOthers": "Andere schließen",
    "agentManager.tab.closeToRight": "Rechts schließen",
    "agentManager.review.showMore": "{{count}} weitere anzeigen",
    "agentManager.review.showLess": "Weniger anzeigen",
    "agentManager.review.clearAll": "Alle löschen",
    "agentManager.diff.openFile": "Datei öffnen",
  }
}
