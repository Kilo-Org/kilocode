function canonical(providerID: string, modelID: string) {
  const value = modelID.includes("/") ? modelID : `${providerID}/${modelID}`
  if (!value.startsWith("kilo/")) return value
  const unprefixed = value.slice("kilo/".length)
  return unprefixed.includes("/") ? unprefixed : value
}

export function modelLabel(providerID: string, modelID: string) {
  return canonical(providerID, modelID)
}

export function modelUrl(providerID: string, modelID: string) {
  const slug = canonical(providerID, modelID)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `https://kilo.ai/models/${slug}`
}
