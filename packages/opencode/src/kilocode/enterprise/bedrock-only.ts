/**
 * Enterprise Bedrock-only mode configuration.
 *
 * When BEDROCK_ONLY=true (or BEDROCK_ONLY=1), the application:
 * - Only allows AWS Bedrock as an LLM provider
 * - Blocks all network calls to Kilo Gateway, PostHog, and external services
 * - Disables telemetry, session export, cloud sessions, and remote config
 * - Fails closed if AWS Bedrock is not configured
 */

export const BEDROCK_ONLY_ENV = "BEDROCK_ONLY"
export const AWS_REGION_ENV = "AWS_REGION"
export const AWS_ACCESS_KEY_ID_ENV = "AWS_ACCESS_KEY_ID"
export const AWS_SECRET_ACCESS_KEY_ENV = "AWS_SECRET_ACCESS_KEY"
export const AWS_PROFILE_ENV = "AWS_PROFILE"
export const AWS_SESSION_TOKEN_ENV = "AWS_SESSION_TOKEN"

const BEDROCK_ALLOWED_PATTERNS = [
  /^bedrock-runtime\..+\.amazonaws\.com$/,
  /^bedrock\..+\.amazonaws\.com$/,
  /^bedrockchat\..+\.amazonaws\.com$/,
  /^(https?:\/\/)?bedrock-runtime\..+\.amazonaws\.com/,
  /^(https?:\/\/)?bedrock\..+\.amazonaws\.com/,
]

const BEDROCK_ALLOWED_NPM = new Set([
  "@ai-sdk/amazon-bedrock",
])

export function isBedrockOnlyEnabled(): boolean {
  const val = process.env[BEDROCK_ONLY_ENV]
  return val === "true" || val === "1"
}

export function isBedrockAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    return BEDROCK_ALLOWED_PATTERNS.some((p) => p.test(host) || p.test(url))
  } catch {
    return false
  }
}

export function isBedrockAllowedNpm(npm: string): boolean {
  return BEDROCK_ALLOWED_NPM.has(npm)
}

export function assertBedrockConfigured(): void {
  if (!isBedrockOnlyEnabled()) return

  const hasRegion = Boolean(process.env[AWS_REGION_ENV])
  const hasAccessKey = Boolean(process.env[AWS_ACCESS_KEY_ID_ENV] && process.env[AWS_SECRET_ACCESS_KEY_ENV])
  const hasProfile = Boolean(process.env[AWS_PROFILE_ENV])
  const hasSessionToken = Boolean(process.env[AWS_SESSION_TOKEN_ENV] && hasAccessKey)

  const configured = hasRegion && (hasAccessKey || hasProfile || hasSessionToken)

  if (!configured) {
    const msg =
      "Enterprise Bedrock-only mode is enabled. AWS Bedrock must be configured. " +
      "No fallback provider is allowed. " +
      `Set ${AWS_REGION_ENV} and one of (${AWS_ACCESS_KEY_ID_ENV}+${AWS_SECRET_ACCESS_KEY_ENV}, ` +
      `${AWS_PROFILE_ENV}, or standard AWS credential chain). ` +
      `Environment variable: ${BEDROCK_ONLY_ENV}=true`
    throw new Error(msg)
  }
}

export function getBedrockConfigError(): string | null {
  if (!isBedrockOnlyEnabled()) return null

  const hasRegion = Boolean(process.env[AWS_REGION_ENV])
  const hasAccessKey = Boolean(process.env[AWS_ACCESS_KEY_ID_ENV] && process.env[AWS_SECRET_ACCESS_KEY_ENV])
  const hasProfile = Boolean(process.env[AWS_PROFILE_ENV])

  if (!hasRegion) return `AWS_REGION environment variable is required for Bedrock-only mode`
  if (!hasAccessKey && !hasProfile)
    return `AWS credentials are required. Set ${AWS_ACCESS_KEY_ID_ENV}+${AWS_SECRET_ACCESS_KEY_ENV} or ${AWS_PROFILE_ENV}`
  return null
}

export const BEDROCK_ONLY_ERROR =
  "Enterprise Bedrock-only mode is enabled. AWS Bedrock must be configured. No fallback provider is allowed."
