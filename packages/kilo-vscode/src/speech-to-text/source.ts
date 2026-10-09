export type SpeechToTextSource = {
  baseUrl: string
  apiKey?: string
}

export type SpeechToTextConfig = {
  experimental?: {
    speech_to_text_base_url?: string
    speech_to_text_api_key?: string
    speech_to_text_model?: string
  }
}

export function resolveSpeechToTextSource(cfg?: SpeechToTextConfig): SpeechToTextSource | undefined {
  const base = trim(cfg?.experimental?.speech_to_text_base_url)
  if (!base) return undefined
  return { baseUrl: base.replace(/\/+$/, ""), apiKey: trim(cfg?.experimental?.speech_to_text_api_key) }
}

/**
 * The speech-to-text keys are machine-wide: the settings UI writes them to the
 * global config. A project overlay must not enable or redirect voice input, so
 * the effective config sent to the webview keeps only the global values.
 */
export function withGlobalSpeechToText<T extends SpeechToTextConfig>(cfg: T, global?: SpeechToTextConfig | null): T {
  const experimental = { ...cfg.experimental }
  const host = global?.experimental
  experimental.speech_to_text_base_url = host?.speech_to_text_base_url
  experimental.speech_to_text_api_key = host?.speech_to_text_api_key
  experimental.speech_to_text_model = host?.speech_to_text_model
  return { ...cfg, experimental } as T
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
