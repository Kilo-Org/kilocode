import { dict as autocompleteDict } from "./autocomplete/ja"
import { dict as attentionDict } from "./attention/ja"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
