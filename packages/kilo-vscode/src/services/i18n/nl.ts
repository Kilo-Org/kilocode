import { dict as autocompleteDict } from "./autocomplete/nl"
import { dict as attentionDict } from "./attention/nl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
