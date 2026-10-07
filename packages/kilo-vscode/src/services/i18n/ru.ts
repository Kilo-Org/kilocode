import { dict as autocompleteDict } from "./autocomplete/ru"
import { dict as attentionDict } from "./attention/ru"
import { dict as mcpDict } from "./mcp/ru"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
