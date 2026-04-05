import type { NamedError } from "@opencode-ai/util/error"

export const KILO_ERROR_CODES = {
  PAID_MODEL_AUTH_REQUIRED: "PAID_MODEL_AUTH_REQUIRED",
  PROMOTION_MODEL_LIMIT_REACHED: "PROMOTION_MODEL_LIMIT_REACHED",
} as const

export type KiloErrorCode = (typeof KILO_ERROR_CODES)[keyof typeof KILO_ERROR_CODES]

const KILO_ERROR_CODE_VALUES = Object.values(KILO_ERROR_CODES) as string[]

/**
 * Check if an error is a Kilo-specific error (has a known Kilo error code in responseBody).
 * Currently all Kilo errors are non-retryable, but this may change in the future.
 */
export function isKiloError(error: ReturnType<NamedError["toObject"]>): boolean {
  return parseKiloErrorCode(error) !== undefined
}

/**
 * Get a user-friendly title for a Kilo error code.
 */
export function kiloErrorTitle(code: KiloErrorCode): string {
  switch (code) {
    case KILO_ERROR_CODES.PAID_MODEL_AUTH_REQUIRED:
      return "You need to sign in to use this model"
    case KILO_ERROR_CODES.PROMOTION_MODEL_LIMIT_REACHED:
      return "You need to sign up to keep going"
  }
}

/**
 * Get a user-friendly description for a Kilo error code.
 */
export function kiloErrorDescription(code: KiloErrorCode): string {
  switch (code) {
    case KILO_ERROR_CODES.PAID_MODEL_AUTH_REQUIRED:
      return "Sign in or create an account to access over 500 models, use credits at cost, or bring your own key."
    case KILO_ERROR_CODES.PROMOTION_MODEL_LIMIT_REACHED:
      return "Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later."
  }
}

/**
 * Show a warning toast with the appropriate Kilo error title/description.
 * Caller should check isKiloError() first.
 */
export function showKiloErrorToast(
  error: ReturnType<NamedError["toObject"]>,
  toast: { show: (opts: { variant: "warning"; title: string; message: string; duration: number }) => void },
): void {
  const code = parseKiloErrorCode(error)
  if (!code) return
  toast.show({
    variant: "warning",
    title: kiloErrorTitle(code),
    message: kiloErrorDescription(code),
    duration: 5000,
  })
}

/**
 * Extract the specific Kilo error code from an APIError's responseBody.
 * Returns the code string if found, undefined otherwise.
 *
 * Note: We check error.name === "APIError" directly instead of using
 * MessageV2.APIError.isInstance() to avoid a circular dependency
 * (message-v2.ts re-exports from this file).
 */
export function parseKiloErrorCode(error: ReturnType<NamedError["toObject"]>): KiloErrorCode | undefined {
  if (error.name !== "APIError") return undefined
  const responseBody = error.data?.responseBody
  if (typeof responseBody !== "string") return undefined
  try {
    const body = JSON.parse(responseBody)
    // Backend sends: { error: { code: "PAID_MODEL_AUTH_REQUIRED" } }
    // or: { code: "PROMOTION_MODEL_LIMIT_REACHED" }
    const code = body?.error?.code ?? body?.code
    if (typeof code === "string" && KILO_ERROR_CODE_VALUES.includes(code)) {
      return code as KiloErrorCode
    }
  } catch {}
  return undefined
}
