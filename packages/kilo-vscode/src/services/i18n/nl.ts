import { dict as autocompleteDict } from "./autocomplete/nl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
