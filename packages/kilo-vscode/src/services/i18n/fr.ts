import { dict as autocompleteDict } from "./autocomplete/fr"
import { dict as attentionDict } from "./attention/fr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
