import { dict as autocompleteDict } from "./autocomplete/it"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'L\'attività "{{title}}" è in esecuzione',
  "kilocode:sleep.statusBar.tooltip":
    "La sospensione del sistema viene impedita durante l'esecuzione delle attività. Il blocco e la sospensione dello schermo non cambiano. Fai clic per consentire la sospensione del sistema.",
} as const
