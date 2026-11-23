import { dict as autocompleteDict } from "./autocomplete/zht"
import { dict as attentionDict } from "./attention/zht"
import { dict as mcpDict } from "./mcp/zht"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
