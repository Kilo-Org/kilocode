import { dict as autocompleteDict } from "./autocomplete/ar"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "المهمة «{{title}}» قيد التشغيل",
  "kilocode:sleep.statusBar.tooltip":
    "يُمنع سكون النظام أثناء تشغيل المهام. لا يتأثر قفل الشاشة أو سكون العرض. انقر للسماح بسكون النظام.",
} as const
