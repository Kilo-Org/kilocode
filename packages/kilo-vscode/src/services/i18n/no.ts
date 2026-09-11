import { dict as autocompleteDict } from "./autocomplete/no"
import { dict as attentionDict } from "./attention/no"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
