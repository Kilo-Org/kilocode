// kilocode_change - new file
//
// AI/ML API (aimlapi.com) guided onboarding — endpoint & attribution config.
//
// Production URLs are the compiled-in defaults; every host is overridable via
// the corresponding AIMLAPI_*_URL env var (used by the AIMLAPI team to test
// against staging). Do not hardcode non-production URLs here.

export type AimlapiEndpoints = {
  /** auth service - mints the user access (Bearer) token. */
  authBaseUrl: string
  /** app BFF - hosts `/v3/partner-checkout/*` and `/v1/keys`. */
  appBaseUrl: string
  /** hosted checkout frontend base URL. */
  payBaseUrl: string
  /** OpenAI-compatible inference base URL (provider `api`). */
  inferenceBaseUrl: string
  /** browser landing page after checkout / consent completes. */
  verificationBaseUrl: string
}

const DEFAULT_ENDPOINTS: AimlapiEndpoints = {
  authBaseUrl: "https://auth.aimlapi.com",
  appBaseUrl: "https://app.aimlapi.com",
  payBaseUrl: "https://pay.aimlapi.com",
  inferenceBaseUrl: "https://api.aimlapi.com/v1",
  verificationBaseUrl: "https://aimlapi.com/app",
}

/**
 * Partner id (`^part_[A-Za-z0-9]{1,64}$`) — rebate attribution for Kilo Code.
 * Must match an active partner registered with AI/ML API. Overridable via
 * AIMLAPI_PARTNER_ID (the AIMLAPI team uses a test partner on staging).
 *
 * TODO(aimlapi): replace with the production Kilo Code partner id before the
 * upstream PR ships.
 */
export const DEFAULT_PARTNER_ID = ""
export const DEFAULT_PARTNER_NAME = "Kilo Code"

/** Name attached to API keys issued through this flow. */
export const ISSUED_KEY_NAME = "Kilo CLI"

/** Top-up bounds enforced by the backend DTO (USD minor units / cents). */
export const MIN_AMOUNT_USD_MINOR = 2000 // $20
export const MAX_AMOUNT_USD_MINOR = 1_000_000 // $10,000
export const DEFAULT_AMOUNT_USD_MINOR = 2500 // $25

export const DEFAULT_RETURN_URL = "https://aimlapi.com/app"

export function resolveEndpoints(): AimlapiEndpoints {
  return {
    authBaseUrl: process.env["AIMLAPI_AUTH_URL"]?.trim() || DEFAULT_ENDPOINTS.authBaseUrl,
    appBaseUrl: process.env["AIMLAPI_APP_URL"]?.trim() || DEFAULT_ENDPOINTS.appBaseUrl,
    payBaseUrl: process.env["AIMLAPI_PAY_URL"]?.trim() || DEFAULT_ENDPOINTS.payBaseUrl,
    inferenceBaseUrl: process.env["AIMLAPI_INFERENCE_URL"]?.trim() || DEFAULT_ENDPOINTS.inferenceBaseUrl,
    verificationBaseUrl:
      process.env["AIMLAPI_VERIFICATION_BASE_URL"]?.trim() || DEFAULT_ENDPOINTS.verificationBaseUrl,
  }
}

/** Resolve checkout attribution with one shared precedence. */
export function resolvePartnerId(explicit?: string): string {
  return explicit?.trim() || process.env["AIMLAPI_PARTNER_ID"]?.trim() || DEFAULT_PARTNER_ID
}

/**
 * Build the co-branded checkout return URLs the hosted payment page redirects
 * to after the user pays or cancels. `sessionToken` + `partnerCheckout=1` make
 * the AI/ML API `/checkout` page render the co-branded result screen.
 */
export function buildPartnerCheckoutReturnUrls(
  payBaseUrl: string,
  sessionToken: string,
): { successUrl?: string; cancelUrl?: string } {
  const base = safeHttpBaseUrl(payBaseUrl)
  if (!base) return {}
  const token = encodeURIComponent(sessionToken)
  const query = (status: string): string => `checkout=${status}&partnerCheckout=1&sessionToken=${token}`
  return {
    successUrl: `${base}/checkout?${query("success")}`,
    cancelUrl: `${base}/checkout?${query("cancel")}`,
  }
}

/**
 * Browser landing URL after checkout. The CLI learns success by polling, so
 * this must be an ordinary HTTPS page rather than an unregistered custom scheme.
 */
export function buildPartnerReturnUrl(frontendBaseUrl: string): string {
  const override = safeHttpBaseUrl(process.env["AIMLAPI_RETURN_URL"])
  if (override) return override
  return safeHttpBaseUrl(frontendBaseUrl) ?? DEFAULT_RETURN_URL
}

function safeHttpBaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const loopback =
      url.hostname === "localhost" || /^127(?:\.\d+){3}$/.test(url.hostname) || url.hostname === "[::1]"
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.href.replace(/\/+$/, "")
  } catch {
    return null
  }
}
