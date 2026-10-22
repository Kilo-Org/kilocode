import { dict as app } from "../../i18n/uk"
import { dict as ui } from "@kilocode/kilo-ui/i18n/uk"
import { dict as kilo } from "@kilocode/kilo-i18n/uk"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Розгалужити сесію",
    "agentManager.tab.pin": "Закріпити",
    "agentManager.tab.unpin": "Відкріпити",
    "agentManager.tab.pinned": "Закріплено",
    "agentManager.tab.close": "Закрити",
    "agentManager.tab.closeOthers": "Закрити інші",
    "agentManager.tab.closeToRight": "Закрити праворуч",
    "agentManager.review.showMore": "Показати ще {{count}}",
    "agentManager.review.showLess": "Показати менше",
    "agentManager.review.clearAll": "Очистити все",
    "agentManager.diff.openFile": "Відкрити файл",
  }
}
