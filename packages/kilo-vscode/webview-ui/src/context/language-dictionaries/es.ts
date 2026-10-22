import { dict as app } from "../../i18n/es"
import { dict as ui } from "@kilocode/kilo-ui/i18n/es"
import { dict as kilo } from "@kilocode/kilo-i18n/es"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Bifurcar sesión",
    "agentManager.tab.pin": "Fijar",
    "agentManager.tab.unpin": "Dejar de fijar",
    "agentManager.tab.pinned": "Fijada",
    "agentManager.tab.close": "Cerrar",
    "agentManager.tab.closeOthers": "Cerrar otras",
    "agentManager.tab.closeToRight": "Cerrar a la derecha",
    "agentManager.review.showMore": "Mostrar {{count}} más",
    "agentManager.review.showLess": "Mostrar menos",
    "agentManager.review.clearAll": "Borrar todo",
    "agentManager.diff.openFile": "Abrir archivo",
  }
}
