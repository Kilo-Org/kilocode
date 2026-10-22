import { dict as autocompleteDict } from "./autocomplete/tr"
import { dict as attentionDict } from "./attention/tr"
import { dict as mcpDict } from "./mcp/tr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
