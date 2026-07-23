import { dict as autocompleteDict } from "./autocomplete/fa"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
