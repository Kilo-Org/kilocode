import { dict as autocompleteDict } from "./autocomplete/bs"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
