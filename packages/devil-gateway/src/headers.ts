import {
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  HEADER_MACHINEID,
  HEADER_FEATURE,
  USER_AGENT_BASE,
  CONTENT_TYPE,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  ENV_VERSION,
  TESTER_SUPPRESS_VALUE,
  ENV_FEATURE,
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
export const X_KILOCODE_MACHINEID = HEADER_MACHINEID
export const X_KILOCODE_FEATURE = HEADER_FEATURE

/**
 * Get feature header value from KILOCODE_FEATURE env var.
 * Returns undefined when not set — the gateway stores NULL (unattributed).
 * Callers must explicitly set the env var to get attribution.
 */
export function getFeatureHeader(): string | undefined {
  return process.env[ENV_FEATURE] || undefined
}

/**
 * Get User-Agent header value.
 * Appends the version from KILOCODE_VERSION when available.
 */
export function getUserAgent(): string {
  const version = process.env[ENV_VERSION]
  return version ? `${USER_AGENT_BASE}/${version}` : USER_AGENT_BASE
}

/**
 * Default headers for KiloCode requests
 */
export function getDefaultHeaders(): Record<string, string> {
  return {
    "User-Agent": getUserAgent(),
    "Content-Type": CONTENT_TYPE,
  }
}

/**
 * Get editor name header value
 * Defaults to "Kilo CLI" but can be customized via KILOCODE_EDITOR_NAME.
 * Appends the version from KILOCODE_VERSION when available.
 */
export function getEditorNameHeader(): string {
  const name = process.env[ENV_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME
  const version = process.env[ENV_VERSION]
  return version ? `${name} ${version}` : name
}

/**
 * Build KiloCode-specific headers from metadata and options
 */
export function buildKiloHeaders(
  metadata?: { taskId?: string; projectId?: string },
  options?: {
    kilocodeOrganizationId?: string
    kilocodeTesterWarningsDisabledUntil?: number
    machineId?: string
  },
): Record<string, string> {
  const feature = getFeatureHeader()
  const headers: Record<string, string> = {
    [X_KILOCODE_EDITORNAME]: getEditorNameHeader(),
    ...(feature ? { [X_KILOCODE_FEATURE]: feature } : {}),
  }

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

  if (options?.machineId) {
    headers[X_KILOCODE_MACHINEID] = options.machineId
  }

  return headers
}
