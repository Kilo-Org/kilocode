import { dict as app } from "../../i18n/ru"
import { dict as ui } from "@kilocode/kilo-ui/i18n/ru"
import { dict as kilo } from "@kilocode/kilo-i18n/ru"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Ответвить сессию",
    "agentManager.tab.pin": "Закрепить",
    "agentManager.tab.unpin": "Открепить",
    "agentManager.tab.pinned": "Закреплена",
    "agentManager.tab.close": "Закрыть",
    "agentManager.tab.closeOthers": "Закрыть остальные",
    "agentManager.tab.closeToRight": "Закрыть справа",
    "agentManager.review.showMore": "Показать ещё {{count}}",
    "agentManager.review.showLess": "Показать меньше",
    "agentManager.review.clearAll": "Очистить всё",
    "agentManager.diff.openFile": "Открыть файл",
  }
}
