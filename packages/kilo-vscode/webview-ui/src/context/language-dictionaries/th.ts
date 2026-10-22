import { dict as app } from "../../i18n/th"
import { dict as ui } from "@kilocode/kilo-ui/i18n/th"
import { dict as kilo } from "@kilocode/kilo-i18n/th"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "แยกเซสชัน",
    "agentManager.tab.pin": "ปักหมุด",
    "agentManager.tab.unpin": "เลิกปักหมุด",
    "agentManager.tab.pinned": "ปักหมุดแล้ว",
    "agentManager.tab.close": "ปิด",
    "agentManager.tab.closeOthers": "ปิดแท็บอื่น",
    "agentManager.tab.closeToRight": "ปิดแท็บทางขวา",
    "agentManager.review.showMore": "แสดงเพิ่มอีก {{count}} รายการ",
    "agentManager.review.showLess": "แสดงน้อยลง",
    "agentManager.review.clearAll": "ล้างทั้งหมด",
    "agentManager.diff.openFile": "เปิดไฟล์",
  }
}
