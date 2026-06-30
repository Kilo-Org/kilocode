import { dict as autocompleteDict } from "./autocomplete/fr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
