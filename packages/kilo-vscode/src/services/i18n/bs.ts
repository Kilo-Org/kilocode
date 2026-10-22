import { dict as autocompleteDict } from "./autocomplete/bs"
import { dict as attentionDict } from "./attention/bs"
import { dict as mcpDict } from "./mcp/bs"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
