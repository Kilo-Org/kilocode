import { dict as autocompleteDict } from "./autocomplete/ar"
import { dict as attentionDict } from "./attention/ar"
import { dict as mcpDict } from "./mcp/ar"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
