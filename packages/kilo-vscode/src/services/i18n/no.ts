import { dict as autocompleteDict } from "./autocomplete/no"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'Oppgaven "{{title}}" kjører',
  "kilocode:sleep.statusBar.tooltip":
    "Systemhvile hindres mens oppgaver kjører. Skjermlåsing og skjermhvile påvirkes ikke. Klikk for å tillate systemhvile.",
} as const
