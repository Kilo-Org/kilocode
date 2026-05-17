export const PASTE_SUMMARY_ENABLED_KEY = "paste_summary_enabled"

type PasteSummaryKV = {
  get(key: string, defaultValue?: boolean): boolean
}

type PasteSummaryConfig = {
  experimental?: {
    disable_paste_summary?: boolean
  }
}

export function isPasteSummaryEnabled(kv: PasteSummaryKV, config: PasteSummaryConfig) {
  if (config.experimental?.disable_paste_summary) return false
  return kv.get(PASTE_SUMMARY_ENABLED_KEY, true)
}
