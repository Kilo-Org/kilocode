import { dict as autocompleteDict } from "./autocomplete/ru"
import { dict as attentionDict } from "./attention/ru"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
