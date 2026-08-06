import type { Provider } from "@/provider/provider"

const VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/

export function reasoningSummary(model: Provider.Model) {
  if (model.api.npm !== "@ai-sdk/openai") return "auto"
  const version = Number(VERSION_RE.exec(model.api.id)?.[1]) || undefined
  // GPT-5.6 auto summaries can contain only a title, so request the detailed summary explicitly.
  return version === 6 ? "detailed" : "auto"
}
