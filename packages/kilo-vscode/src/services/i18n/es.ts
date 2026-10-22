import { dict as autocompleteDict } from "./autocomplete/es"
import { dict as attentionDict } from "./attention/es"
import { dict as mcpDict } from "./mcp/es"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
