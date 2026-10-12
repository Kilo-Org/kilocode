import { dict as autocompleteDict } from "./autocomplete/fr"
import { dict as attentionDict } from "./attention/fr"
import { dict as mcpDict } from "./mcp/fr"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
