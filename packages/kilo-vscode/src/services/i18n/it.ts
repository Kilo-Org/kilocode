import { dict as autocompleteDict } from "./autocomplete/it"
import { dict as attentionDict } from "./attention/it"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
