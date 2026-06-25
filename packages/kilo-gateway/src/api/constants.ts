/**
 * Kilo Gateway Configuration Constants
 * Centralized configuration for all API endpoints, headers, and settings
 */

/** Environment variable for the Relay gateway URL. */
export const ENV_KILO_API_URL = "RELAY_GATEWAY_URL"

/**
 * Default Relay gateway URL.
 *
 * Relay never talks to api.kilo.ai. The gateway is either:
 *   - the user's local Docker container (default localhost:4000)
 *   - the Relay Cloud deployment (set RELAY_GATEWAY_URL=https://gateway.relay.dev)
 *   - the customer's self-hosted gateway in their VPC
 *
 * Legacy KILO_API_URL is honored as a fallback so the transition doesn't
 * surprise users who already had it set; can be removed once docs/configs
 * are updated.
 */
export const DEFAULT_KILO_API_URL = "http://localhost:4000"

/** Base URL for the Relay gateway. */
export const KILO_API_BASE =
  process.env[ENV_KILO_API_URL] || process.env.KILO_API_URL || DEFAULT_KILO_API_URL

/** Environment variable for custom Kilo Chat URL */
export const KILO_CHAT_URL_ENV = "KILO_CHAT_URL"

/** Default Kilo Chat URL (REST endpoint for messages, conversations, etc.) */
export const KILO_DEFAULT_CHAT_URL = "https://chat.kiloapps.io"

/** Base URL for Kilo Chat - can be overridden by KILO_CHAT_URL env var */
export const KILO_CHAT_URL = process.env[KILO_CHAT_URL_ENV] || KILO_DEFAULT_CHAT_URL

/** Environment variable for custom Event Service URL */
export const KILO_EVENT_SERVICE_URL_ENV = "EVENT_SERVICE_URL"

/** Default Event Service URL (WebSocket endpoint for kilo-chat events) */
export const KILO_DEFAULT_EVENT_SERVICE_URL = "wss://events.kiloapps.io"

/** Base URL for Event Service - can be overridden by EVENT_SERVICE_URL env var */
export const KILO_EVENT_SERVICE_URL = process.env[KILO_EVENT_SERVICE_URL_ENV] || KILO_DEFAULT_EVENT_SERVICE_URL

/**
 * Default base URL for the gateway's OpenAI-compatible endpoint.
 *
 * LiteLLM exposes `/v1/chat/completions`, `/v1/embeddings`, `/v1/models`,
 * etc. Just `${gateway}/v1`. The constant keeps its legacy name so we
 * don't churn 20 importers; the value it returns is what's accurate.
 */
export const KILO_OPENROUTER_BASE = `${KILO_API_BASE}/v1`

/** Device auth polling interval in milliseconds */
export const POLL_INTERVAL_MS = 3000

/** Default model for authenticated users */
export const DEFAULT_MODEL = "kilo-auto/free"

/** Default model for anonymous/free usage */
export const DEFAULT_FREE_MODEL = "kilo-auto/free"

/** Token expiration duration in milliseconds (1 year) */
export const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000

/** User-Agent header base value for requests */
export const USER_AGENT_BASE = "opencode-kilo-provider"

/** Content-Type header value for requests */
export const CONTENT_TYPE = "application/json"

/** Default provider name */
export const DEFAULT_PROVIDER_NAME = "kilo"

/** Default API key for anonymous requests */
export const ANONYMOUS_API_KEY = "anonymous"

/** Fetch timeout for model requests in milliseconds (10 seconds) */
export const MODELS_FETCH_TIMEOUT_MS = 10 * 1000

/**
 * Header constants for KiloCode API requests
 */
export const HEADER_ORGANIZATIONID = "X-KILOCODE-ORGANIZATIONID"
export const HEADER_TASKID = "X-KILOCODE-TASKID"
export const HEADER_PARENT_TASKID = "X-KILOCODE-PARENT-TASKID"
export const HEADER_PROJECTID = "X-KILOCODE-PROJECTID"
export const HEADER_TESTER = "X-KILOCODE-TESTER"
export const HEADER_EDITORNAME = "X-KILOCODE-EDITORNAME"
export const HEADER_MACHINEID = "X-KILOCODE-MACHINEID"

/** Default editor name value */
export const DEFAULT_EDITOR_NAME = "Kilo CLI"

/** Environment variable name for custom editor name */
export const ENV_EDITOR_NAME = "KILOCODE_EDITOR_NAME"

/** Environment variable name for version (set by CLI at startup) */
export const ENV_VERSION = "KILOCODE_VERSION"

/** Tester header value for suppressing warnings */
export const TESTER_SUPPRESS_VALUE = "SUPPRESS"

/** Header name for feature tracking */
export const HEADER_FEATURE = "X-KILOCODE-FEATURE"

/** Environment variable name for feature override */
export const ENV_FEATURE = "KILOCODE_FEATURE"

export const PROMPTS = [
  "codex",
  "gemini",
  "beast",
  "anthropic",
  "trinity",
  "anthropic_without_todo",
  "ling",
  "gpt55",
] as const

export const AI_SDK_PROVIDERS = [
  "alibaba",
  "anthropic",
  "mistral",
  "openai",
  "openai-compatible",
  "openrouter",
] as const
