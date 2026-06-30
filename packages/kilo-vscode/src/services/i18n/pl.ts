import { dict as autocompleteDict } from "./autocomplete/pl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
