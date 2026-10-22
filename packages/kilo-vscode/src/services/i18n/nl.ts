import { dict as autocompleteDict } from "./autocomplete/nl"
import { dict as attentionDict } from "./attention/nl"
import { dict as mcpDict } from "./mcp/nl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
