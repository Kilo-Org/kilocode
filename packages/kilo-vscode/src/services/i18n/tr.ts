import { dict as autocompleteDict } from "./autocomplete/tr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": '"{{title}}" görevi çalışıyor',
  "kilocode:sleep.statusBar.tooltip":
    "Görevler çalışırken sistem uykusu önlenir. Ekran kilidi ve ekran uykusu etkilenmez. Sistem uykusuna izin vermek için tıklayın.",
} as const
