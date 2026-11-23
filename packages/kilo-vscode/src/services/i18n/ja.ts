import { dict as autocompleteDict } from "./autocomplete/ja"
import { dict as attentionDict } from "./attention/ja"
import { dict as mcpDict } from "./mcp/ja"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
