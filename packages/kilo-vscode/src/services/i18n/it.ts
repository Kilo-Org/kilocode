import { dict as autocompleteDict } from "./autocomplete/it"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
