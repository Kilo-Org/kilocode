import { dict as autocompleteDict } from "./autocomplete/ja"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "タスク「{{title}}」を実行中",
  "kilocode:sleep.statusBar.tooltip":
    "タスク実行中はシステムスリープを防止します。画面ロックとディスプレイのスリープには影響しません。クリックするとシステムスリープを許可します。",
} as const
