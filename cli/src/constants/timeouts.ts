/**
 * Timeout constants for the CLI
 * Centralizes all timeout-related values to improve maintainability and consistency
 */

// -----------------------------------------------------------------------------
// Base Units
// -----------------------------------------------------------------------------
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS

// -----------------------------------------------------------------------------
// Requests & Services
// -----------------------------------------------------------------------------
/**
 * Delay after refreshing router models to allow them to load (1 second)
 */
export const MODEL_REFRESH_DELAY_MS = 1 * SECOND_MS

/**
 * Task history request timeout (5 seconds)
 * @see cli.ts, state/hooks/useTaskHistory.ts
 */
export const TASK_HISTORY_REQUEST_TIMEOUT_MS = 5 * SECOND_MS

/**
 * Default retry delay for approval decisions (10 seconds)
 * Used when config.retry.delay is not specified
 */
export const DEFAULT_RETRY_DELAY_MS = 10 * SECOND_MS

/**
 * Task completion timeout (90 seconds)
 * @see pr/on-task-completed.ts
 */
export const TASK_COMPLETION_TIMEOUT_MS = 90 * SECOND_MS

/**
 * Router models request timeout (30 seconds)
 * @see services/models/fetcher.ts
 */
export const ROUTER_MODELS_TIMEOUT_MS = 30 * SECOND_MS

/**
 * Extension service ready timeout (10 seconds)
 * @see services/models/fetcher.ts
 */
export const EXTENSION_SERVICE_READY_TIMEOUT_MS = 10 * SECOND_MS

/**
 * Kilocode API request timeout (5 seconds)
 * @see auth/providers/kilocode/shared.ts
 */
export const KILOCODE_API_REQUEST_TIMEOUT_MS = 5 * SECOND_MS

// -----------------------------------------------------------------------------
// Storage & Caching
// -----------------------------------------------------------------------------
/**
 * Maximum age for clipboard images (1 hour)
 * @see media/clipboard-shared.ts
 */
export const MAX_CLIPBOARD_IMAGE_AGE_MS = 1 * HOUR_MS

/**
 * Clipboard status message duration for success (2 seconds)
 * @see state/atoms/keyboard.ts
 */
export const CLIPBOARD_STATUS_SUCCESS_TIMEOUT_MS = 2 * SECOND_MS

/**
 * Clipboard status message duration for errors (3 seconds)
 * @see state/atoms/keyboard.ts
 */
export const CLIPBOARD_STATUS_ERROR_TIMEOUT_MS = 3 * SECOND_MS

/**
 * File search cache TTL (5 minutes)
 * @see services/fileSearch.ts
 */
export const FILE_SEARCH_CACHE_TTL_MS = 5 * MINUTE_MS

// -----------------------------------------------------------------------------
// UI & UX
// -----------------------------------------------------------------------------
/**
 * Shell command execution timeout (30 seconds)
 * @see state/atoms/shell.ts
 */
export const SHELL_COMMAND_TIMEOUT_MS = 30 * SECOND_MS

/**
 * Safety timeout to reset cancelling state (10 seconds)
 * @see ui/components/StatusIndicator.tsx
 */
export const CANCELLING_SAFETY_TIMEOUT_MS = 10 * SECOND_MS

/**
 * Error message auto-clear timeout (5 seconds)
 * @see state/atoms/ui.ts
 */
export const UI_ERROR_MESSAGE_TIMEOUT_MS = 5 * SECOND_MS

// -----------------------------------------------------------------------------
// Telemetry
// -----------------------------------------------------------------------------
/**
 * Telemetry flush interval (5 seconds)
 * @see services/telemetry/TelemetryClient.ts
 */
export const TELEMETRY_FLUSH_INTERVAL_MS = 5 * SECOND_MS

// -----------------------------------------------------------------------------
// Terminal & Keyboard
// -----------------------------------------------------------------------------
/**
 * Terminal capability detection fallback timeout (200ms)
 * @see ui/utils/terminalCapabilities.ts
 */
export const TERMINAL_CAPABILITIES_TIMEOUT_MS = 200

/**
 * Terminal capability progressive enhancement timeout (1 second)
 * @see ui/utils/terminalCapabilities.ts
 */
export const TERMINAL_CAPABILITIES_PROGRESSIVE_TIMEOUT_MS = 1000

/**
 * Paste detection timeout for keyboard protocol (10ms)
 * @see constants/keyboard/kittyProtocol.ts
 */
export const PASTE_DETECTION_TIMEOUT_MS = 10

// -----------------------------------------------------------------------------
// Parallel Mode
// -----------------------------------------------------------------------------
/**
 * Commit completion timeout for parallel mode (40 seconds)
 * @see parallel/parallel.ts
 */
export const COMMIT_COMPLETION_TIMEOUT_MS = 40 * SECOND_MS
