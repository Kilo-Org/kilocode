import {
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  HEADER_FEATURE, // kilocode_change
  USER_AGENT,
  CONTENT_TYPE,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  TESTER_SUPPRESS_VALUE,
  ENV_FEATURE, // kilocode_change
} from "./api/constants.js"

/**
 * Header constants for KiloCode API requests
 * @deprecated Use HEADER_* constants from constants.ts instead
 */
export const X_KILOCODE_ORGANIZATIONID = HEADER_ORGANIZATIONID
export const X_KILOCODE_TASKID = HEADER_TASKID
export const X_KILOCODE_PROJECTID = HEADER_PROJECTID
export const X_KILOCODE_TESTER = HEADER_TESTER
export const X_KILOCODE_EDITORNAME = HEADER_EDITORNAME
export const X_KILOCODE_FEATURE = HEADER_FEATURE // kilocode_change

/**
 * Get feature header value from KILOCODE_FEATURE env var.
 * Returns undefined when not set — the gateway stores NULL (unattributed).
 * Callers must explicitly set the env var to get attribution.
 */
// kilocode_change start
export function getFeatureHeader(): string | undefined {
  return process.env[ENV_FEATURE] || undefined
}
// kilocode_change end

/**
 * Default headers for KiloCode requests
 */
export const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Content-Type": CONTENT_TYPE,
}

/**
 * Get editor name header value
 * Defaults to "opencode" but can be customized
 */
export function getEditorNameHeader(): string {
  return process.env[ENV_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME
}

/**
 * Build KiloCode-specific headers from metadata and options
 */
export function buildKiloHeaders(
  metadata?: { taskId?: string; projectId?: string },
  options?: {
    kilocodeOrganizationId?: string
    kilocodeTesterWarningsDisabledUntil?: number
  },
): Record<string, string> {
  // kilocode_change start
  const feature = getFeatureHeader()
  const headers: Record<string, string> = {
    [X_KILOCODE_EDITORNAME]: getEditorNameHeader(),
    ...(feature ? { [X_KILOCODE_FEATURE]: feature } : {}),
  }
  // kilocode_change end

  if (metadata?.taskId) {
    headers[X_KILOCODE_TASKID] = metadata.taskId
  }

  if (options?.kilocodeOrganizationId) {
    headers[X_KILOCODE_ORGANIZATIONID] = options.kilocodeOrganizationId

    if (metadata?.projectId) {
      headers[X_KILOCODE_PROJECTID] = metadata.projectId
    }
  }

  // Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
  if (options?.kilocodeTesterWarningsDisabledUntil && options.kilocodeTesterWarningsDisabledUntil > Date.now()) {
    headers[X_KILOCODE_TESTER] = TESTER_SUPPRESS_VALUE
  }

  return headers
}
