import { dict as autocompleteDict } from "./autocomplete/ar"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
