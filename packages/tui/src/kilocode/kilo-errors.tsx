import { SplitBorder } from "../ui/border"
import { useTheme } from "../context/theme"
import { isRecord } from "../util/record"

export type KiloErrorCode = "PAID_MODEL_AUTH_REQUIRED" | "PROMOTION_MODEL_LIMIT_REACHED" | "INVALID_TOKEN"

export type KiloSessionError = {
  status?: number
  response?: { body: string }
}

const TITLES: Record<KiloErrorCode, string> = {
  PAID_MODEL_AUTH_REQUIRED: "You need to sign in to use this model",
  PROMOTION_MODEL_LIMIT_REACHED: "You need to sign up to keep going",
  INVALID_TOKEN: "You've been signed out of Kilo",
}

const DESCRIPTIONS: Record<KiloErrorCode, string> = {
  PAID_MODEL_AUTH_REQUIRED:
    "Sign in or create an account to access over 500 models, use credits at cost, or bring your own key.",
  PROMOTION_MODEL_LIMIT_REACHED:
    "Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later.",
  INVALID_TOKEN: "Your Kilo session is no longer valid. Sign in again, then resend your message.",
}

export function kiloErrorTitle(code: KiloErrorCode): string {
  return TITLES[code]
}

export function kiloErrorDescription(code: KiloErrorCode): string {
  return DESCRIPTIONS[code]
}

export function parseKiloErrorCode(error: KiloSessionError | undefined): KiloErrorCode | undefined {
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

export function KiloErrorBlock(props: { code: KiloErrorCode }) {
  const theme = useTheme()
  return (
    <box
      marginLeft={2}
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      backgroundColor={theme.background.raised.base}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.text.feedback.warning.base}
    >
      <text fg={theme.text.base}>{kiloErrorTitle(props.code)}</text>
      <text fg={theme.text.muted} wrapMode="word">
        {kiloErrorDescription(props.code)}
      </text>
      <text fg={theme.text.feedback.warning.base}>
        {"Run /connect or `kilo auth login` to connect to Kilo Gateway"}
      </text>
    </box>
  )
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
