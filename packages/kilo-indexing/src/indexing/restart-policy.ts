import { DEFAULT_VECTOR_STORE } from "./constants"
import { isEmbeddingProfileEqual, resolveEmbeddingProfile } from "./embedding-profile"
import type { PreviousConfigSnapshot } from "./interfaces/config"
import { getDefaultModelId } from "./model-registry"

type ConfigSnapshot = Readonly<PreviousConfigSnapshot>

// Connection changes count even for inactive providers and when LanceDB is the selected store.
const connectionFields = [
  "kiloApiKey",
  "kiloBaseUrl",
  "kiloOrganizationId",
  "openAiKey",
  "ollamaBaseUrl",
  "openAiCompatibleBaseUrl",
  "openAiCompatibleApiKey",
  "geminiApiKey",
  "mistralApiKey",
  "vercelAiGatewayApiKey",
  "bedrockRegion",
  "bedrockProfile",
  "openRouterApiKey",
  "openRouterSpecificProvider",
  "voyageApiKey",
  "qdrantUrl",
  "qdrantApiKey",
] as const satisfies readonly (keyof ConfigSnapshot)[]

/** Compares applied indexing settings without loading services or resolving host configuration. */
export function requiresIndexingRestart(previous: ConfigSnapshot, current: ConfigSnapshot): boolean {
  if (!current.enabled) return !!previous.enabled
  if (!previous.enabled || !previous.configured) return current.configured

  if ((previous.embedderProvider ?? "openai") !== current.embedderProvider) return true

  const store = current.vectorStoreProvider ?? DEFAULT_VECTOR_STORE
  if ((previous.vectorStoreProvider ?? DEFAULT_VECTOR_STORE) !== store) return true
  if (
    store === "lancedb" &&
    (previous.lancedbVectorStoreDirectory ?? "") !== (current.lancedbVectorStoreDirectory ?? "")
  )
    return true

  if (connectionFields.some((field) => (previous[field] ?? "") !== (current[field] ?? ""))) return true
  if (previous.fileExtensions.join("\0") !== current.fileExtensions.join("\0")) return true

  return hasEmbeddingProfileChanged(previous, current)
}

function hasEmbeddingProfileChanged(previous: ConfigSnapshot, current: ConfigSnapshot): boolean {
  // The provider is already known to match (after applying the previous provider default).
  const provider = current.embedderProvider
  const before = resolveEmbeddingProfile(provider, previous.modelId, previous.modelDimension)
  const after = resolveEmbeddingProfile(provider, current.modelId, current.modelDimension)
  if (before && after) return !isEmbeddingProfileEqual(before, after)

  // A missing dimension does not count as a profile change on its own.
  const defaultId = getDefaultModelId(provider)
  return (previous.modelId ?? defaultId) !== (current.modelId ?? defaultId)
}
