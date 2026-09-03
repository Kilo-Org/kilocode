import { dict as autocompleteDict } from "./autocomplete/th"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
