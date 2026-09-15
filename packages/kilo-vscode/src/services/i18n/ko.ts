import { dict as autocompleteDict } from "./autocomplete/ko"
import { dict as attentionDict } from "./attention/ko"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
} as const
