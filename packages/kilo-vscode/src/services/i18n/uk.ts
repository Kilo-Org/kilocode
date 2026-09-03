import { dict as autocompleteDict } from "./autocomplete/uk"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "Завдання «{{title}}» виконується",
  "kilocode:sleep.statusBar.tooltip":
    "Перехід системи в режим сну блокується під час виконання завдань. Блокування екрана та вимкнення дисплея не змінюються. Натисніть, щоб дозволити режим сну системи.",
} as const
