import { dict as app } from "../../i18n/ko"
import { dict as ui } from "@kilocode/kilo-ui/i18n/ko"
import { dict as kilo } from "@kilocode/kilo-i18n/ko"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    ...app,
    ...ui,
    ...kilo,
    "agentManager.tab.forkSession": "세션 포크",
    "agentManager.tab.pin": "고정",
    "agentManager.tab.unpin": "고정 해제",
    "agentManager.tab.pinned": "고정됨",
    "agentManager.tab.close": "닫기",
    "agentManager.tab.closeOthers": "다른 탭 닫기",
    "agentManager.tab.closeToRight": "오른쪽 탭 닫기",
    "agentManager.review.showMore": "{{count}}개 더 보기",
    "agentManager.review.showLess": "간략히 보기",
    "agentManager.review.clearAll": "모두 지우기",
    "agentManager.diff.openFile": "파일 열기",
  }
}
