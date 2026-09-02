import { dict as autocompleteDict } from "./autocomplete/zh"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "任务“{{title}}”正在运行",
  "kilocode:sleep.statusBar.tooltip": "任务运行时会阻止系统休眠。屏幕锁定和显示器休眠不受影响。点击以允许系统休眠。",
} as const
