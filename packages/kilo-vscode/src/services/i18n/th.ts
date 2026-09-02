import { dict as autocompleteDict } from "./autocomplete/th"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'งาน "{{title}}" กำลังทำงาน',
  "kilocode:sleep.statusBar.tooltip":
    "ระบบจะไม่พักเครื่องขณะงานกำลังทำงาน การล็อกและการพักหน้าจอไม่ได้รับผลกระทบ คลิกเพื่ออนุญาตให้ระบบพักเครื่อง",
} as const
