import { dict as autocompleteDict } from "./autocomplete/fa"
import { dict as attentionDict } from "./attention/fa"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
