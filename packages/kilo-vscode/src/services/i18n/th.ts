import { dict as autocompleteDict } from "./autocomplete/th"
import { dict as attentionDict } from "./attention/th"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
