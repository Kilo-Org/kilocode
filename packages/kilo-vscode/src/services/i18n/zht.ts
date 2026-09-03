import { dict as autocompleteDict } from "./autocomplete/zht"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
