import { dict as autocompleteDict } from "./autocomplete/ko"
import { dict as attentionDict } from "./attention/ko"
import { dict as mcpDict } from "./mcp/ko"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
