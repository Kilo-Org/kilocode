import { dict as autocompleteDict } from "./autocomplete/no"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
