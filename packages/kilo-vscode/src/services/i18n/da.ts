import { dict as autocompleteDict } from "./autocomplete/da"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
