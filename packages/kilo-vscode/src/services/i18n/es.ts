import { dict as autocompleteDict } from "./autocomplete/es"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'La tarea "{{title}}" se está ejecutando',
  "kilocode:sleep.statusBar.tooltip":
    "Se impide la suspensión del sistema mientras se ejecutan tareas. El bloqueo de pantalla y la suspensión de la pantalla no cambian. Haz clic para permitir la suspensión del sistema.",
} as const
