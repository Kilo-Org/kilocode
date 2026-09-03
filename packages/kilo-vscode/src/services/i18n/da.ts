import { dict as autocompleteDict } from "./autocomplete/da"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'Opgaven "{{title}}" kører',
  "kilocode:sleep.statusBar.tooltip":
    "Systemslumring forhindres, mens opgaver kører. Skærmlås og slumring af skærmen påvirkes ikke. Klik for at tillade systemslumring.",
} as const
