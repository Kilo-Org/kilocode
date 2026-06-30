import { dict as autocompleteDict } from "./autocomplete/uk"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
