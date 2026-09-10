import { dict as autocompleteDict } from "./autocomplete/pl"
import { dict as attentionDict } from "./attention/pl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
