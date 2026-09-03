import { dict as autocompleteDict } from "./autocomplete/nl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'Taak "{{title}}" wordt uitgevoerd',
  "kilocode:sleep.statusBar.tooltip":
    "Systeemstand-by wordt voorkomen terwijl taken worden uitgevoerd. Schermvergrendeling en schermstand-by blijven ongewijzigd. Klik om systeemstand-by toe te staan.",
} as const
