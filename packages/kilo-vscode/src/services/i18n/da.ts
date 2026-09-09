import { dict as autocompleteDict } from "./autocomplete/da"
import { dict as attentionDict } from "./attention/da"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
