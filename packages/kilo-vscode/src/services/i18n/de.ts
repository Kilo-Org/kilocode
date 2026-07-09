import { dict as autocompleteDict } from "./autocomplete/de"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
