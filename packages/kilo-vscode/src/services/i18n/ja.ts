import { dict as autocompleteDict } from "./autocomplete/ja"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
