import { dict as autocompleteDict } from "./autocomplete/th"
import { dict as attentionDict } from "./attention/th"
import { dict as mcpDict } from "./mcp/th"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
