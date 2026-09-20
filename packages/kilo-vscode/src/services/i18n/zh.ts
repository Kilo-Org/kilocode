import { dict as autocompleteDict } from "./autocomplete/zh"
import { dict as attentionDict } from "./attention/zh"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
