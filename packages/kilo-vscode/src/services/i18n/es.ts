import { dict as autocompleteDict } from "./autocomplete/es"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
