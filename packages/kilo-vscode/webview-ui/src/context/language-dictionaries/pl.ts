import { dict as app } from "../../i18n/pl"
import { dict as ui } from "@kilocode/kilo-ui/i18n/pl"
import { dict as kilo } from "@kilocode/kilo-i18n/pl"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Rozgałęź sesję",
    "agentManager.tab.pin": "Przypnij",
    "agentManager.tab.unpin": "Odepnij",
    "agentManager.tab.pinned": "Przypięta",
    "agentManager.tab.close": "Zamknij",
    "agentManager.tab.closeOthers": "Zamknij pozostałe",
    "agentManager.tab.closeToRight": "Zamknij po prawej",
    "agentManager.review.showMore": "Pokaż {{count}} więcej",
    "agentManager.review.showLess": "Pokaż mniej",
    "agentManager.review.clearAll": "Wyczyść wszystko",
    "agentManager.diff.openFile": "Otwórz plik",
  }
}
