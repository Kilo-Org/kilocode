import { dict as autocompleteDict } from "./autocomplete/ru"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "Задача «{{title}}» выполняется",
  "kilocode:sleep.statusBar.tooltip":
    "Переход системы в спящий режим блокируется во время выполнения задач. Блокировка экрана и отключение дисплея не затрагиваются. Нажмите, чтобы разрешить спящий режим системы.",
} as const
