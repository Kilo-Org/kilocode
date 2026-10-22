import { dict as app } from "../../i18n/fr"
import { dict as ui } from "@kilocode/kilo-ui/i18n/fr"
import { dict as kilo } from "@kilocode/kilo-i18n/fr"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Dupliquer la session",
    "agentManager.tab.pin": "Épingler",
    "agentManager.tab.unpin": "Détacher",
    "agentManager.tab.pinned": "Épinglée",
    "agentManager.tab.close": "Fermer",
    "agentManager.tab.closeOthers": "Fermer les autres",
    "agentManager.tab.closeToRight": "Fermer à droite",
    "agentManager.review.showMore": "Afficher {{count}} de plus",
    "agentManager.review.showLess": "Afficher moins",
    "agentManager.review.clearAll": "Tout effacer",
    "agentManager.diff.openFile": "Ouvrir le fichier",
  }
}
