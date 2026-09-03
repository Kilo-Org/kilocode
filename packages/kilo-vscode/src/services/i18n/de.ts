import { dict as autocompleteDict } from "./autocomplete/de"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'Aufgabe "{{title}}" wird ausgeführt',
  "kilocode:sleep.statusBar.tooltip":
    "Während Aufgaben ausgeführt werden, wird der Systemruhezustand verhindert. Bildschirmsperre und Display-Ruhezustand bleiben unverändert. Klicken, um den Systemruhezustand zuzulassen.",
} as const
