import { dict as autocompleteDict } from "./autocomplete/bs"
import { dict as attentionDict } from "./attention/bs"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
