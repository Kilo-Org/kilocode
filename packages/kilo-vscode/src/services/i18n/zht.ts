import { dict as autocompleteDict } from "./autocomplete/zht"
import { dict as attentionDict } from "./attention/zht"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
