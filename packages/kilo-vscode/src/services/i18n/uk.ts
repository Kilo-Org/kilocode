import { dict as autocompleteDict } from "./autocomplete/uk"
import { dict as attentionDict } from "./attention/uk"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
