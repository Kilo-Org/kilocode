import { dict as autocompleteDict } from "./autocomplete/da"
import { dict as attentionDict } from "./attention/da"
import { dict as mcpDict } from "./mcp/da"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
