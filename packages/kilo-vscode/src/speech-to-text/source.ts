export type SpeechToTextSource = {
  baseUrl: string
  apiKey?: string
}

export type SpeechToTextSettings = {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export function hasCustomSource(source?: SpeechToTextSource): source is SpeechToTextSource {
  return !!source?.baseUrl
}

export function sourceUrl(source: SpeechToTextSource, route: string): string {
  return `${source.baseUrl}/${route.replace(/^\/+/, "")}`
}

export function sourceHeaders(source: SpeechToTextSource): Record<string, string> {
  return source.apiKey ? { Authorization: `Bearer ${source.apiKey}` } : {}
}

/** The transcript prompt for models that must not paraphrase the speaker. */
export const VERBATIM_PROMPT =
  "Transcribe exactly what is spoken. Do not paraphrase, summarize, infer intent, or rewrite for clarity. Preserve the speaker's original wording as closely as possible, including incomplete phrases and unusual wording when audible."
