import { dict as autocompleteDict } from "./autocomplete/de"
import { dict as attentionDict } from "./attention/de"
import { dict as mcpDict } from "./mcp/de"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
