import { dict as autocompleteDict } from "./autocomplete/en"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": 'Task "{{title}}" is running',
  "kilocode:sleep.statusBar.tooltip":
    "System sleep is prevented while tasks run. Screen locking and display sleep remain unchanged. Click to allow system sleep.",
} as const
