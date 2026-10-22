import { dict as app } from "../../i18n/zht"
import { dict as ui } from "@kilocode/kilo-ui/i18n/zht"
import { dict as kilo } from "@kilocode/kilo-i18n/zht"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "複製工作階段",
    "agentManager.tab.pin": "釘選",
    "agentManager.tab.unpin": "取消釘選",
    "agentManager.tab.pinned": "已釘選",
    "agentManager.tab.close": "關閉",
    "agentManager.tab.closeOthers": "關閉其他分頁",
    "agentManager.tab.closeToRight": "關閉右側分頁",
    "agentManager.review.showMore": "顯示更多 {{count}} 則",
    "agentManager.review.showLess": "顯示更少",
    "agentManager.review.clearAll": "全部清除",
    "agentManager.diff.openFile": "開啟檔案",
  }
}
