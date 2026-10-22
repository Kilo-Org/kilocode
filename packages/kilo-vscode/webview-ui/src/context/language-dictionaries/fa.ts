import { dict as app } from "../../i18n/fa"
import { dict as ui } from "@kilocode/kilo-ui/i18n/fa"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  // Persian has no localized Kilo override layer, so it inherits the English base.
  return {
    ...base,
    ...app,
    ...ui,
    "agentManager.tab.forkSession": "انشعاب جلسه",
    "agentManager.tab.pin": "سنجاق کردن",
    "agentManager.tab.unpin": "برداشتن سنجاق",
    "agentManager.tab.pinned": "سنجاق‌شده",
    "agentManager.tab.close": "بستن",
    "agentManager.tab.closeOthers": "بستن بقیه",
    "agentManager.tab.closeToRight": "بستن سمت راست",
    "agentManager.review.showMore": "نمایش {{count}} مورد بیشتر",
    "agentManager.review.showLess": "نمایش کمتر",
    "agentManager.review.clearAll": "پاک کردن همه",
    "agentManager.diff.openFile": "باز کردن فایل",
  }
}
