import { dict as autocompleteDict } from "./autocomplete/ko"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
} as const
