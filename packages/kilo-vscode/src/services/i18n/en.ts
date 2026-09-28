import { dict as autocompleteDict } from "./autocomplete/en"
import { dict as attentionDict } from "./attention/en"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
