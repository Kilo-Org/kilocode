/**
 * Enterprise Bedrock-only mode configuration.
 *
 * When BEDROCK_ONLY=true (or BEDROCK_ONLY=1), the application:
 * - Only allows AWS Bedrock in eu-west-1 as the LLM provider
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

export const ALLOWED_BEDROCK_REGION = "eu-west-1"

const BEDROCK_ALLOWED_HOSTS = [
  `bedrock-runtime.${ALLOWED_BEDROCK_REGION}.amazonaws.com`,
  `bedrock.${ALLOWED_BEDROCK_REGION}.amazonaws.com`,
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
    return BEDROCK_ALLOWED_HOSTS.includes(host)
  } catch {
    return false
  }
}

export function isBedrockAllowedNpm(npm: string): boolean {
  return BEDROCK_ALLOWED_NPM.has(npm)
}

export function assertBedrockConfigured(): void {
  if (!isBedrockOnlyEnabled()) return

  const region = process.env[AWS_REGION_ENV]
  const hasAccessKey = Boolean(process.env[AWS_ACCESS_KEY_ID_ENV] && process.env[AWS_SECRET_ACCESS_KEY_ENV])
  const hasProfile = Boolean(process.env[AWS_PROFILE_ENV])
  const hasSessionToken = Boolean(process.env[AWS_SESSION_TOKEN_ENV] && hasAccessKey)

  const configured = region && (hasAccessKey || hasProfile || hasSessionToken)

  if (!configured) {
    throw new Error(BEDROCK_ONLY_ERROR)
  }

  if (region !== ALLOWED_BEDROCK_REGION) {
    throw new Error(
      `Enterprise Bedrock-only mode requires AWS_REGION=${ALLOWED_BEDROCK_REGION}. ` +
        `Received AWS_REGION=${region}. No other region is allowed.`,
    )
  }
}

export function getBedrockConfigError(): string | null {
  if (!isBedrockOnlyEnabled()) return null

  const region = process.env[AWS_REGION_ENV]
  const hasAccessKey = Boolean(process.env[AWS_ACCESS_KEY_ID_ENV] && process.env[AWS_SECRET_ACCESS_KEY_ENV])
  const hasProfile = Boolean(process.env[AWS_PROFILE_ENV])

  if (!region) return `AWS_REGION environment variable is required for Bedrock-only mode (must be ${ALLOWED_BEDROCK_REGION})`
  if (region !== ALLOWED_BEDROCK_REGION) return `AWS_REGION must be ${ALLOWED_BEDROCK_REGION}, got ${region}`
  if (!hasAccessKey && !hasProfile)
    return `AWS credentials are required. Set ${AWS_ACCESS_KEY_ID_ENV}+${AWS_SECRET_ACCESS_KEY_ENV} or ${AWS_PROFILE_ENV}`
  return null
}

export const BEDROCK_ONLY_ERROR =
  "Enterprise Bedrock-only mode is enabled. AWS Bedrock must be configured " +
  `in region eu-west-1. No fallback provider is allowed. ` +
  `Set AWS_REGION=${ALLOWED_BEDROCK_REGION} and AWS credentials.`

export function getAwsRegion(): string {
  return process.env[AWS_REGION_ENV] || ALLOWED_BEDROCK_REGION
}
