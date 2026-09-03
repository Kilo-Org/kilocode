import { dict as autocompleteDict } from "./autocomplete/ko"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": '작업 "{{title}}" 실행 중',
  "kilocode:sleep.statusBar.tooltip":
    "작업 실행 중에는 시스템 절전 모드를 방지합니다. 화면 잠금과 디스플레이 절전에는 영향을 주지 않습니다. 시스템 절전을 허용하려면 클릭하세요.",
} as const
