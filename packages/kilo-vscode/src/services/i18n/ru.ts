import { dict as autocompleteDict } from "./autocomplete/ru"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
