import { dict as autocompleteDict } from "./autocomplete/zh"
import { dict as attentionDict } from "./attention/zh"
import { dict as mcpDict } from "./mcp/zh"

export { autocompleteDict }

export const dict = {
  ...autocompleteDict,
  ...attentionDict,
  ...mcpDict,
} as const
