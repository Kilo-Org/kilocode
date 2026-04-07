import type { NamedError } from "@opencode-ai/util/error"

export const DEVIL_ERROR_CODES = {
  PAID_MODEL_AUTH_REQUIRED: "PAID_MODEL_AUTH_REQUIRED",
  PROMOTION_MODEL_LIMIT_REACHED: "PROMOTION_MODEL_LIMIT_REACHED",
} as const

export type DevilErrorCode = (typeof DEVIL_ERROR_CODES)[keyof typeof DEVIL_ERROR_CODES]

const DEVIL_ERROR_CODE_VALUES = Object.values(DEVIL_ERROR_CODES) as string[]

/**
 * Check if an error is a Devil-specific error (has a known Devil error code in responseBody).
 * Currently all Devil errors are non-retryable, but this may change in the future.
 */
export function isDevilError(error: ReturnType<NamedError["toObject"]>): boolean {
  return parseDevilErrorCode(error) !== undefined
}

/**
 * Get a user-friendly title for a Devil error code.
 */
export function kiloErrorTitle(code: DevilErrorCode): string {
  switch (code) {
    case DEVIL_ERROR_CODES.PAID_MODEL_AUTH_REQUIRED:
      return "You need to sign in to use this model"
    case DEVIL_ERROR_CODES.PROMOTION_MODEL_LIMIT_REACHED:
      return "You need to sign up to keep going"
  }
}

/**
 * Get a user-friendly description for a Devil error code.
 */
export function kiloErrorDescription(code: DevilErrorCode): string {
  switch (code) {
    case DEVIL_ERROR_CODES.PAID_MODEL_AUTH_REQUIRED:
      return "Sign in or create an account to access over 500 models, use credits at cost, or bring your own key."
    case DEVIL_ERROR_CODES.PROMOTION_MODEL_LIMIT_REACHED:
      return "Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later."
  }
}

/**
 * Show a warning toast with the appropriate Devil error title/description.
 * Caller should check isDevilError() first.
 */
export function showDevilErrorToast(
  error: ReturnType<NamedError["toObject"]>,
  toast: { show: (opts: { variant: "warning"; title: string; message: string; duration: number }) => void },
): void {
  const code = parseDevilErrorCode(error)
  if (!code) return
  toast.show({
    variant: "warning",
    title: kiloErrorTitle(code),
    message: kiloErrorDescription(code),
    duration: 5000,
  })
}

/**
 * Extract the specific Devil error code from an APIError's responseBody.
 * Returns the code string if found, undefined otherwise.
 *
 * Note: We check error.name === "APIError" directly instead of using
 * MessageV2.APIError.isInstance() to avoid a circular dependency
 * (message-v2.ts re-exports from this file).
 */
export function parseDevilErrorCode(error: ReturnType<NamedError["toObject"]>): DevilErrorCode | undefined {
  if (error.name !== "APIError") return undefined
  const responseBody = error.data?.responseBody
  if (typeof responseBody !== "string") return undefined
  try {
    const body = JSON.parse(responseBody)
    // Backend sends: { error: { code: "PAID_MODEL_AUTH_REQUIRED" } }
    // or: { code: "PROMOTION_MODEL_LIMIT_REACHED" }
    const code = body?.error?.code ?? body?.code
    if (typeof code === "string" && DEVIL_ERROR_CODE_VALUES.includes(code)) {
      return code as DevilErrorCode
    }
  } catch {}
  return undefined
}
