// ============================================================================
// Plugin
// ============================================================================
export { DevilAuthPlugin, default } from "./plugin.js"

// ============================================================================
// Provider
// ============================================================================
export { createDevil } from "./provider.js"
export { createDevilDebug } from "./provider-debug.js"
export { kiloCustomLoader } from "./loader.js"
export { buildDevilHeaders, getEditorNameHeader, getFeatureHeader, getDefaultHeaders, getUserAgent } from "./headers.js"

// ============================================================================
// Auth
// ============================================================================
export { authenticateWithDeviceAuth } from "./auth/device-auth.js"
export { authenticateWithDeviceAuthTUI } from "./auth/device-auth-tui.js"
export { getDevilUrlFromToken, isValidDevilcodeToken, getApiKey } from "./auth/token.js"
export { poll, formatTimeRemaining } from "./auth/polling.js"
export { migrateLegacyDevilAuth, LEGACY_CONFIG_PATH } from "./auth/legacy-migration.js"

// ============================================================================
// API
// ============================================================================
export {
  fetchProfile,
  fetchBalance,
  fetchProfileWithBalance,
  fetchDefaultModel,
  getDevilProfile,
  getDevilBalance,
  getDevilDefaultModel,
  promptOrganizationSelection,
} from "./api/profile.js"
export { fetchDevilModels } from "./api/models.js"
export {
  fetchOrganizationModes,
  clearModesCache,
  type OrganizationMode,
  type OrganizationModeConfig,
} from "./api/modes.js"
export { fetchDevilcodeNotifications, type DevilcodeNotification } from "./api/notifications.js"

// ============================================================================
// Server Routes (optional - requires hono and OpenCode dependencies)
// ============================================================================
export { createDevilRoutes } from "./server/routes.js"

// ============================================================================
// Note: TUI exports moved to separate entry point
// ============================================================================
// For TUI components and commands, import from "@devilcode/kilo-gateway/tui"
// This avoids circular dependencies with opencode TUI infrastructure

// ============================================================================
// Types
// ============================================================================
export type {
  // Auth types
  DeviceAuthInitiateResponse,
  DeviceAuthPollResponse,
  Organization,
  DevilcodeProfile,
  DevilcodeBalance,
  PollOptions,
  PollResult,
  // Provider types
  DevilProvider,
  DevilProviderOptions,
  DevilMetadata,
  CustomLoaderResult,
  ProviderInfo,
  LanguageModelV2,
} from "./types.js"

// ============================================================================
// Constants
// ============================================================================
export {
  ENV_DEVIL_API_URL,
  DEFAULT_DEVIL_API_URL,
  DEVIL_API_BASE,
  DEVIL_OPENROUTER_BASE,
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
