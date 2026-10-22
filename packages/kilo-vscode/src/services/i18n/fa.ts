import { dict as autocompleteDict } from "./autocomplete/fa"
import { dict as attentionDict } from "./attention/fa"
import { dict as mcpDict } from "./mcp/fa"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
