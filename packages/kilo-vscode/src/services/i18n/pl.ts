import { dict as autocompleteDict } from "./autocomplete/pl"
import { dict as attentionDict } from "./attention/pl"
import { dict as mcpDict } from "./mcp/pl"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
