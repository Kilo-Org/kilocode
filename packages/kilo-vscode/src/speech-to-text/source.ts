export type SpeechToTextSource = {
  baseUrl: string
  apiKey?: string
}

export type SpeechToTextConfig = {
  experimental?: {
    speech_to_text_base_url?: string
    speech_to_text_api_key?: string
  }
}

export function resolveSpeechToTextSource(cfg?: SpeechToTextConfig): SpeechToTextSource | undefined {
  const base = trim(cfg?.experimental?.speech_to_text_base_url)
  if (!base) return undefined
  return { baseUrl: base.replace(/\/+$/, ""), apiKey: trim(cfg?.experimental?.speech_to_text_api_key) }
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

function trim(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
