import { dict as autocompleteDict } from "./autocomplete/uk"
import { dict as attentionDict } from "./attention/uk"
import { dict as mcpDict } from "./mcp/uk"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
