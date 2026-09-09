import { dict as autocompleteDict } from "./autocomplete/ar"
import { dict as attentionDict } from "./attention/ar"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
