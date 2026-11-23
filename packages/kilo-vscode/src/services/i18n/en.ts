import { dict as autocompleteDict } from "./autocomplete/en"
import { dict as attentionDict } from "./attention/en"
import { dict as mcpDict } from "./mcp/en"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
