import { dict as autocompleteDict } from "./autocomplete/fr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'La tâche "{{title}}" est en cours d’exécution',
  "kilocode:sleep.statusBar.tooltip":
    "La mise en veille du système est bloquée pendant l’exécution des tâches. Le verrouillage de l’écran et la mise en veille de l’affichage restent inchangés. Cliquez pour autoriser la mise en veille du système.",
} as const
