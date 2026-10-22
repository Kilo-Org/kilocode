import { dict as autocompleteDict } from "./autocomplete/br"
import { dict as attentionDict } from "./attention/br"
import { dict as mcpDict } from "./mcp/br"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
