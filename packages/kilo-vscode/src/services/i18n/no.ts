import { dict as autocompleteDict } from "./autocomplete/no"
import { dict as attentionDict } from "./attention/no"
import { dict as mcpDict } from "./mcp/no"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
