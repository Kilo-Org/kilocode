import { dict as autocompleteDict } from "./autocomplete/es"
import { dict as attentionDict } from "./attention/es"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
