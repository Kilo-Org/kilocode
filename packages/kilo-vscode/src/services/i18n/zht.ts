import { dict as autocompleteDict } from "./autocomplete/zht"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "任務「{{title}}」正在執行",
  "kilocode:sleep.statusBar.tooltip": "任務執行時會防止系統休眠。螢幕鎖定和顯示器休眠不受影響。點擊以允許系統休眠。",
} as const
