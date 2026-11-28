/** Ollama's local OpenAI-compatible route accepts sampling temperature even
 * when generated model metadata says this capability is unsupported. */
export function isExplicitOllamaTemperature(providerID: string, temperature: number | undefined) {
  return temperature !== undefined && /^(?:ollama|ollama[_-]local)$/.test(providerID)
}
