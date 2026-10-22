import { dict as app } from "../../i18n/br"
import { dict as ui } from "@kilocode/kilo-ui/i18n/br"
import { dict as kilo } from "@kilocode/kilo-i18n/br"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Bifurcar sessão",
    "agentManager.tab.pin": "Fixar",
    "agentManager.tab.unpin": "Desafixar",
    "agentManager.tab.pinned": "Fixada",
    "agentManager.tab.close": "Fechar",
    "agentManager.tab.closeOthers": "Fechar outras",
    "agentManager.tab.closeToRight": "Fechar à direita",
    "agentManager.review.showMore": "Mostrar mais {{count}}",
    "agentManager.review.showLess": "Mostrar menos",
    "agentManager.review.clearAll": "Limpar tudo",
    "agentManager.diff.openFile": "Abrir arquivo",
  }
}
