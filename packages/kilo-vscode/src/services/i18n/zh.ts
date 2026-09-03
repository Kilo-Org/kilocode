import { dict as autocompleteDict } from "./autocomplete/zh"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
