import { dict as app } from "../../i18n/bs"
import { dict as ui } from "@kilocode/kilo-ui/i18n/bs"
import { dict as kilo } from "@kilocode/kilo-i18n/bs"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "Razdvoji sesiju",
    "agentManager.tab.pin": "Zakači",
    "agentManager.tab.unpin": "Otkači",
    "agentManager.tab.pinned": "Zakačeno",
    "agentManager.tab.close": "Zatvori",
    "agentManager.tab.closeOthers": "Zatvori ostale",
    "agentManager.tab.closeToRight": "Zatvori desno",
    "agentManager.review.showMore": "Prikaži još {{count}}",
    "agentManager.review.showLess": "Prikaži manje",
    "agentManager.review.clearAll": "Očisti sve",
    "agentManager.diff.openFile": "Otvori datoteku",
  }
}
