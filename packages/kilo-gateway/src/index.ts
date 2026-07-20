// ============================================================================
// Plugin
// ============================================================================
export { KiloAuthPlugin, default } from "./plugin.js"

// ============================================================================
// Provider
// ============================================================================
export { createKilo } from "./provider.js"
export { createKiloDebug } from "./provider-debug.js"
export { kiloCustomLoader } from "./loader.js"
export { buildKiloHeaders, getEditorNameHeader, getFeatureHeader, getDefaultHeaders, getUserAgent } from "./headers.js"

// ============================================================================
// Auth
// ============================================================================
export { authenticateWithDeviceAuth } from "./auth/device-auth.js"
export { authenticateWithDeviceAuthTUI } from "./auth/device-auth-tui.js"
export { getKiloUrlFromToken, isValidKilocodeToken, getApiKey } from "./auth/token.js"
export { poll, formatTimeRemaining } from "./auth/polling.js"
export { migrateLegacyKiloAuth, LEGACY_CONFIG_PATH } from "./auth/legacy-migration.js"

// ============================================================================
// API
// ============================================================================
export {
  fetchProfile,
  fetchBalance,
  fetchProfileWithBalance,
  fetchDefaultModel,
  getKiloProfile,
  defaultOrganizationId,
  getKiloBalance,
  getKiloDefaultModel,
  promptOrganizationSelection,
} from "./api/profile.js"
export { fetchKiloPassState } from "./api/kilo-pass.js"
export {
  fetchKiloModels,
  type KiloModelsResult,
  fetchKiloImageModels,
  type KiloImageModel,
  type KiloImageModelsResult,
} from "./api/models.js"
export {
  EMPTY_KILO_EMBEDDING_MODEL_CATALOG,
  fetchKiloEmbeddingModelCatalog,
  type KiloEmbeddingModel,
  type KiloEmbeddingModelCatalog,
  type KiloEmbeddingModelCatalogIssue,
} from "./api/embedding-models.js"
export { resolveKiloGatewayBaseUrl, resolveKiloOpenRouterBaseUrl } from "./api/url.js"
export {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  getAutocompleteModel,
  getAutocompleteModelById,
  validAutocompleteModel,
  validAutocompleteProvider,
  type AutocompleteModelDef,
  type AutocompleteProviderID,
} from "./autocomplete.js"
export {
  fetchOrganizationModes,
  clearModesCache,
  type OrganizationMode,
  type OrganizationModeConfig,
} from "./api/modes.js"
export { fetchKilocodeNotifications, type KilocodeNotification } from "./api/notifications.js"
export {
  CloudTrpcError,
  MiniMaxNativeUsageSchema,
  getAutoTopUpState,
  getCodingPlanUsage,
  listByokEntries,
  listCodingPlanSubscriptions,
  type AutoTopUpState,
  type ByokEntry,
  type CodingPlanSubscription,
  type CodingPlanUsage,
  type MiniMaxNativeUsage,
} from "./api/trpc.js"
export { fetchCloudSession, fetchCloudSessionForImport, importSessionToDb } from "./cloud-sessions.js"

// ============================================================================
// Server Routes (optional - requires hono and OpenCode dependencies)
// ============================================================================
export { createKiloRoutes } from "./server/routes.js"
export {
  GatewayError,
  UnauthorizedError,
  getOrganizationId,
  getClawChatCredentials,
  getClawStatus,
  getCloudSessions,
  getNotifications,
  getProfile,
  getToken,
  normalizeClawStatus,
  setOrganization,
} from "./server/handlers.js"

// ============================================================================
// Note: TUI exports moved to separate entry point
// ============================================================================
// For TUI components and commands, import from "@kilocode/kilo-gateway/tui"
// This avoids circular dependencies with opencode TUI infrastructure

// ============================================================================
// Types
// ============================================================================
export type {
  // Auth types
  DeviceAuthInitiateResponse,
  DeviceAuthPollResponse,
  Organization,
  KilocodeProfile,
  KilocodeBalance,
  KiloPassState,
  PollOptions,
  PollResult,
  // Provider types
  KiloProvider,
  KiloProviderOptions,
  KiloMetadata,
  CustomLoaderResult,
  ProviderInfo,
  LanguageModelV3,
} from "./types.js"

// ============================================================================
// Constants
// ============================================================================
export {
  ENV_KILO_API_URL,
  DEFAULT_KILO_API_URL,
  KILO_API_BASE,
  KILO_CHAT_URL,
  KILO_EVENT_SERVICE_URL,
  KILO_OPENROUTER_BASE,
  POLL_INTERVAL_MS,
  DEFAULT_MODEL,
  DEFAULT_FREE_MODEL,
  TOKEN_EXPIRATION_MS,
  USER_AGENT_BASE,
  CONTENT_TYPE,
  DEFAULT_PROVIDER_NAME,
  ANONYMOUS_API_KEY,
  MODELS_FETCH_TIMEOUT_MS,
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PARENT_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  HEADER_MACHINEID,
  HEADER_FEATURE,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  ENV_VERSION,
  TESTER_SUPPRESS_VALUE,
  ENV_FEATURE,
  PROMPTS,
  AI_SDK_PROVIDERS,
} from "./api/constants.js"
