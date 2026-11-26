export type KiloRunErrorCode = "PAID_MODEL_AUTH_REQUIRED" | "PROMOTION_MODEL_LIMIT_REACHED" | "INVALID_TOKEN"

export type StructuredRunError = {
  type: string
  message: string
  status?: number
  response?: { body: string }
}

const TITLES: Record<KiloRunErrorCode, string> = {
  PAID_MODEL_AUTH_REQUIRED: "You need to sign in to use this model",
  PROMOTION_MODEL_LIMIT_REACHED: "You need to sign up to keep going",
  INVALID_TOKEN: "You've been signed out of Kilo",
}

export function parseKiloErrorCode(
  error: Pick<StructuredRunError, "status" | "response"> | undefined,
): KiloRunErrorCode | undefined {
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
export function kiloErrorLine(
  error: Pick<StructuredRunError, "status" | "response"> | undefined,
): string | undefined {
  const code = parseKiloErrorCode(error)
  if (!code) return undefined
  return `${TITLES[code]}. Run \`kilo auth login\` to connect to Kilo Gateway.`
}

export function formatKiloRunError<T extends StructuredRunError>(error: T | undefined): T | undefined {
  if (!error) return undefined
  const line = kiloErrorLine(error)
  if (!line) return error
  return { ...error, message: line }
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
