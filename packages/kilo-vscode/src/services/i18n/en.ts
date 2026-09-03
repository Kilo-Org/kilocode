import { dict as autocompleteDict } from "./autocomplete/en"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
