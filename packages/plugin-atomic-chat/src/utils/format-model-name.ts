import type { AtomicChatModel } from "../types"

export function extractModelOwner(modelId: string): string | undefined {
  const parts = modelId.split("/")
  if (parts.length > 1) {
    return parts[0]
  }
  return undefined
}

export function formatModelName(model: AtomicChatModel): string {
  const { id } = model
  const parts = id.split("/")
  const modelPart = parts.length > 1 ? parts[1] : parts[0]
  const acronyms = new Set(["gpt", "oss", "api", "gguf", "ggml", "nomic", "vl", "it", "mlx"])

  const tokens = modelPart
    .split(/[-_]/)
    .filter(Boolean)
    .map((token) => {
      const lowerToken = token.toLowerCase()
      if (acronyms.has(lowerToken)) {
        return token.toUpperCase()
      }
      if (/^\d+[bkmg]$/i.test(token)) {
        return token.toUpperCase()
      }
      if (/^q\d+$/i.test(token)) {
        return token.toUpperCase()
      }
      if (/^\d+\.\d+/.test(token)) {
        return token
      }
      if (/^[a-z]\d+[a-z]$/i.test(token) || /^\d+[a-z]$/i.test(token)) {
        return token.toUpperCase()
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    })
    .join(" ")

  return tokens
}
