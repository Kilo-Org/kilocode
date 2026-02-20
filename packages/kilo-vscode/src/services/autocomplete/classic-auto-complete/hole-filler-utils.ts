import type { FillInAtCursorSuggestion } from "../types"

/**
 * Parse a chat completion response and extract the text between <COMPLETION> tags.
 * Returns a FillInAtCursorSuggestion with the extracted text, or empty string if not found.
 */
export function parseAutocompleteResponse(
  fullResponse: string,
  prefix: string,
  suffix: string,
): FillInAtCursorSuggestion {
  let fimText = ""
  const completionMatch = fullResponse.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)
  if (completionMatch) {
    fimText = completionMatch[1] || ""
  }
  fimText = fimText.replace(/<\/?COMPLETION>/gi, "")
  return { text: fimText, prefix, suffix }
}
