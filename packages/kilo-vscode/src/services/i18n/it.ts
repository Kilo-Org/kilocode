import { dict as autocompleteDict } from "./autocomplete/it"
import { dict as attentionDict } from "./attention/it"
import { dict as mcpDict } from "./mcp/it"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
