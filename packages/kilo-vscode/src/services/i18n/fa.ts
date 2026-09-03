import { dict as autocompleteDict } from "./autocomplete/fa"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "وظیفه «{{title}}» در حال اجرا است",
  "kilocode:sleep.statusBar.tooltip":
    "هنگام اجرای وظایف از خواب سیستم جلوگیری می‌شود. قفل صفحه و خواب نمایشگر تغییری نمی‌کنند. برای اجازه دادن به خواب سیستم کلیک کنید.",
} as const
