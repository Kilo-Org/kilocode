import { dict as autocompleteDict } from "./autocomplete/de"
import { dict as attentionDict } from "./attention/de"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
