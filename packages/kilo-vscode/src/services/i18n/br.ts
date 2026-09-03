import { dict as autocompleteDict } from "./autocomplete/br"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'A tarefa "{{title}}" está em execução',
  "kilocode:sleep.statusBar.tooltip":
    "A suspensão do sistema é impedida durante a execução de tarefas. O bloqueio e a suspensão da tela não são afetados. Clique para permitir a suspensão do sistema.",
} as const
