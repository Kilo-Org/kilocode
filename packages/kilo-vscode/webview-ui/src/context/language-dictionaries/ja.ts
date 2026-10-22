import { dict as app } from "../../i18n/ja"
import { dict as ui } from "@kilocode/kilo-ui/i18n/ja"
import { dict as kilo } from "@kilocode/kilo-i18n/ja"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "セッションをフォーク",
    "agentManager.tab.pin": "ピン留め",
    "agentManager.tab.unpin": "ピン留めを解除",
    "agentManager.tab.pinned": "ピン留め済み",
    "agentManager.tab.close": "閉じる",
    "agentManager.tab.closeOthers": "他を閉じる",
    "agentManager.tab.closeToRight": "右側を閉じる",
    "agentManager.review.showMore": "さらに {{count}} 件を表示",
    "agentManager.review.showLess": "表示を減らす",
    "agentManager.review.clearAll": "すべてクリア",
    "agentManager.diff.openFile": "ファイルを開く",
  }
}
