import { dict as app } from "../../i18n/zh"
import { dict as ui } from "@kilocode/kilo-ui/i18n/zh"
import { dict as kilo } from "@kilocode/kilo-i18n/zh"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "复制会话",
    "agentManager.tab.pin": "固定",
    "agentManager.tab.unpin": "取消固定",
    "agentManager.tab.pinned": "已固定",
    "agentManager.tab.close": "关闭",
    "agentManager.tab.closeOthers": "关闭其他标签页",
    "agentManager.tab.closeToRight": "关闭右侧标签页",
    "agentManager.review.showMore": "显示更多 {{count}} 条",
    "agentManager.review.showLess": "显示更少",
    "agentManager.review.clearAll": "全部清除",
    "agentManager.diff.openFile": "打开文件",
  }
}
