import { dict as app } from "../../i18n/it"
import { dict as ui } from "@kilocode/kilo-ui/i18n/it"
import { dict as kilo } from "@kilocode/kilo-i18n/it"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Forka sessione",
    "agentManager.tab.pin": "Fissa",
    "agentManager.tab.unpin": "Rimuovi fissaggio",
    "agentManager.tab.pinned": "Fissata",
    "agentManager.tab.close": "Chiudi",
    "agentManager.tab.closeOthers": "Chiudi le altre",
    "agentManager.tab.closeToRight": "Chiudi a destra",
    "agentManager.review.showMore": "Mostra altri {{count}}",
    "agentManager.review.showLess": "Mostra meno",
    "agentManager.review.clearAll": "Cancella tutto",
    "agentManager.diff.openFile": "Apri file",
  }
}
