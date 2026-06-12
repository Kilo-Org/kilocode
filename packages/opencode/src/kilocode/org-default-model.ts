export function orgDefaultModel(agent: { options?: Record<string, unknown> } | undefined) {
  const model = agent?.options?.orgDefaultModel
  if (typeof model !== "string" || model.length === 0) return
  return { providerID: "kilo", modelID: model } as const
}
