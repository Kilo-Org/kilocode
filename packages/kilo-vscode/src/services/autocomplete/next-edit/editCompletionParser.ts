import { MERCURY_CODE_TO_EDIT_CLOSE, MERCURY_CODE_TO_EDIT_OPEN } from "./constants"

/**
 * Mercury Edit 2 returns the rewritten editable region wrapped in a triple-backtick
 * fence. The system prompt asks the model to include `<|code_to_edit|>` markers,
 * so we strip those as well when present.
 */
export function parseMercuryEditReply(message: string): string | null {
  if (!message) return null

  const fenceOpen = message.indexOf("```")
  if (fenceOpen === -1) return null
  // Skip past the opening fence + optional language tag + newline.
  const afterFenceOpen = message.indexOf("\n", fenceOpen + 3)
  if (afterFenceOpen === -1) return null

  const fenceClose = message.lastIndexOf("```")
  if (fenceClose <= afterFenceOpen) return null

  let body = message.slice(afterFenceOpen + 1, fenceClose)
  // Trim a single trailing newline if the model added one before the fence.
  if (body.endsWith("\n")) body = body.slice(0, -1)

  // Strip Mercury's `<|code_to_edit|>` markers when included.
  body = body.replace(new RegExp(`^${escape(MERCURY_CODE_TO_EDIT_OPEN)}\\n?`), "")
  body = body.replace(new RegExp(`\\n?${escape(MERCURY_CODE_TO_EDIT_CLOSE)}$`), "")

  return body
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
