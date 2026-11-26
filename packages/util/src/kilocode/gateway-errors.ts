export * as KiloGatewayError from "./gateway-errors.js"

export type KiloActionErrorCode = "PAID_MODEL_AUTH_REQUIRED" | "PROMOTION_MODEL_LIMIT_REACHED" | "INVALID_TOKEN"

export type KiloStructuredError = {
  status?: number
  response?: { body: string }
}

const TITLES: Record<KiloActionErrorCode, string> = {
  PAID_MODEL_AUTH_REQUIRED: "You need to sign in to use this model",
  PROMOTION_MODEL_LIMIT_REACHED: "You need to sign up to keep going",
  INVALID_TOKEN: "You've been signed out of Kilo",
}

const DESCRIPTIONS: Record<KiloActionErrorCode, string> = {
  PAID_MODEL_AUTH_REQUIRED:
    "Sign in or create an account to access over 500 models, use credits at cost, or bring your own key.",
  PROMOTION_MODEL_LIMIT_REACHED:
    "Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later.",
  INVALID_TOKEN: "Your Kilo session is no longer valid. Sign in again, then resend your message.",
}

export function title(code: KiloActionErrorCode): string {
  return TITLES[code]
}

export function description(code: KiloActionErrorCode): string {
  return DESCRIPTIONS[code]
}

export function parseCode(error: KiloStructuredError | undefined): KiloActionErrorCode | undefined {
  const body = error?.response?.body
  if (typeof body !== "string") return undefined
  const parsed = parseJson(body)
  if (!isRecord(parsed)) return undefined
  const nested = isRecord(parsed.error) ? parsed.error : undefined
  const raw = asString(nested?.code) ?? asString(parsed.code) ?? asString(parsed.error_type)
  if (!raw) return undefined
  if (raw === "PAID_MODEL_AUTH_REQUIRED" || raw === "paid_model_auth_required") return "PAID_MODEL_AUTH_REQUIRED"
  if (raw === "PROMOTION_MODEL_LIMIT_REACHED" || raw === "promotion_limit_reached")
    return "PROMOTION_MODEL_LIMIT_REACHED"
  // INVALID_TOKEN is a generic name, so it only counts on the 401 the gateway sends with it.
  if (raw === "INVALID_TOKEN") return error?.status === 401 ? "INVALID_TOKEN" : undefined
  return undefined
}

/** One-line form for output that cannot render a card, such as `kilo run`. */
export function line(error: KiloStructuredError | undefined): string | undefined {
  const code = parseCode(error)
  if (!code) return undefined
  return `${TITLES[code]}. Run \`kilo auth login\` to connect to Kilo Gateway.`
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
