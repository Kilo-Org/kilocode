import { dict as autocompleteDict } from "./autocomplete/bs"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'Zadatak "{{title}}" je u toku',
  "kilocode:sleep.statusBar.tooltip":
    "Mirovanje sistema je spriječeno dok su zadaci u toku. Zaključavanje i mirovanje ekrana nisu pogođeni. Kliknite da dozvolite mirovanje sistema.",
} as const
