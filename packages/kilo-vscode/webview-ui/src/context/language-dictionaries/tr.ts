import { dict as app } from "../../i18n/tr"
import { dict as ui } from "@kilocode/kilo-ui/i18n/tr"
import { dict as kilo } from "@kilocode/kilo-i18n/tr"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Oturumu Fork'la",
    "agentManager.tab.pin": "Sabitle",
    "agentManager.tab.unpin": "Sabitlemeyi kaldır",
    "agentManager.tab.pinned": "Sabitlendi",
    "agentManager.tab.close": "Kapat",
    "agentManager.tab.closeOthers": "Diğerlerini kapat",
    "agentManager.tab.closeToRight": "Sağdakileri kapat",
    "agentManager.review.showMore": "{{count}} tane daha göster",
    "agentManager.review.showLess": "Daha az göster",
    "agentManager.review.clearAll": "Tümünü temizle",
    "agentManager.diff.openFile": "Dosyayı aç",
  }
}
