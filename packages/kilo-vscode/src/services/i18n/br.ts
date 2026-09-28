import { dict as autocompleteDict } from "./autocomplete/br"
import { dict as attentionDict } from "./attention/br"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
