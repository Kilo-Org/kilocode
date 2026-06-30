import { dict as autocompleteDict } from "./autocomplete/tr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
