import { dict as autocompleteDict } from "./autocomplete/tr"
import { dict as attentionDict } from "./attention/tr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
