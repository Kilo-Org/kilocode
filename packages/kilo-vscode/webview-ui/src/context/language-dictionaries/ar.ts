import { dict as app } from "../../i18n/ar"
import { dict as ui } from "@kilocode/kilo-ui/i18n/ar"
import { dict as kilo } from "@kilocode/kilo-i18n/ar"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "تفريع الجلسة",
    "agentManager.tab.pin": "تثبيت",
    "agentManager.tab.unpin": "إلغاء التثبيت",
    "agentManager.tab.pinned": "مثبتة",
    "agentManager.tab.close": "إغلاق",
    "agentManager.tab.closeOthers": "إغلاق الآخرين",
    "agentManager.tab.closeToRight": "إغلاق ما على اليمين",
    "agentManager.review.showMore": "إظهار {{count}} أخرى",
    "agentManager.review.showLess": "إظهار أقل",
    "agentManager.review.clearAll": "مسح الكل",
    "agentManager.diff.openFile": "فتح الملف",
  }
}
