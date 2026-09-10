import { dict as autocompleteDict } from "./autocomplete/br"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
