import { dict as autocompleteDict } from "./autocomplete/pl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  "kilocode:sleep.reason": "Zadanie „{{title}}” jest uruchomione",
  "kilocode:sleep.statusBar.tooltip":
    "Uśpienie systemu jest blokowane podczas wykonywania zadań. Blokada ekranu i uśpienie wyświetlacza pozostają bez zmian. Kliknij, aby zezwolić na uśpienie systemu.",
} as const
