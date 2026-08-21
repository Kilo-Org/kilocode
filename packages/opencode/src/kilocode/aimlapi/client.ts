// kilocode_change - new file
//
// AI/ML API passwordless onboarding and partner-checkout HTTP client.
// Protocol mirrors the AIMLAPI integrations shipped in Zero and OpenClaude.

import { aimlapiAttributionHeaders, type AimlapiEndpoints } from "./config"

export type PartnerCheckoutSessionStatus =
  | "pending_auth"
  | "pending_payment"
  | "paid"
  | "exchanging"
  | "exchanged"
  | "cancelled"
  | "expired"
  | "failed"

export type PartnerCheckoutSession = {
  id: string
  sessionToken: string
  partnerId: string
  partnerName: string | null
  userId: number | null
  amountUsdMinor: number | null
  status: PartnerCheckoutSessionStatus
  issuedKeyId: string | null
  returnUrl: string | null
}

export type PaymentSession = {
  providerSessionId: string
  payUrl: string | null
}

export type PayResult = {
  checkout: PaymentSession
  partnerCheckout: PartnerCheckoutSession
}

export type ExchangeResult = { apiKey: string; apiKeyId: string }
export type AuthResult = { token: string; exp: number }
export type AccountCheckResult = {
  action: "sign-in" | "sign-up"
  provider?: string | null
}
export type CreatedKey = { key: string; id: string }
export type BalanceResult = {
  balance: number
  lowBalance: boolean
  lowBalanceThreshold: number
}

const REQUEST_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BODY_BYTES = 1 << 20

function requestLabel(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return "AI/ML API endpoint"
  }
}

function redactRequestSecrets(message: string, url: string, bearer: string | undefined): string {
  const secrets = new Set<string>()
  if (bearer?.trim()) secrets.add(bearer.trim())
  try {
    for (const segment of new URL(url).pathname.split("/")) {
      if (segment.length < 6) continue
      secrets.add(segment)
      try {
        secrets.add(decodeURIComponent(segment))
      } catch {
        // keep the encoded segment when it is not valid percent-encoding
      }
    }
  } catch {
    // the request label already handles malformed URLs without exposing them
  }
  let redacted = message
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]")
  }
  return redacted
}

function isBalanceResult(value: unknown): value is BalanceResult {
  if (typeof value !== "object" || value === null) return false
  const result = value as Record<string, unknown>
  return (
    typeof result["balance"] === "number" &&
    Number.isFinite(result["balance"]) &&
    typeof result["lowBalance"] === "boolean" &&
    typeof result["lowBalanceThreshold"] === "number" &&
    Number.isFinite(result["lowBalanceThreshold"])
  )
}

export class AimlapiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = "AimlapiApiError"
  }
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // keep the deterministic size-limit error if cancellation fails
        }
        throw new AimlapiApiError(`AI/ML API response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`, 0, "")
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

export class AimlapiClient {
  constructor(private readonly endpoints: AimlapiEndpoints) {}

  /** S4 branch point: does this email belong to an existing account? */
  async checkAccount(email: string, signal?: AbortSignal): Promise<AccountCheckResult> {
    return this.request<AccountCheckResult>(`${this.endpoints.authBaseUrl}/v1/auth/account`, {
      method: "PATCH",
      body: { email },
      signal,
    })
  }

  async sendSignInCode(email: string, signal?: AbortSignal): Promise<void> {
    await this.request<void>(`${this.endpoints.authBaseUrl}/v1/auth/sign-in/code`, {
      method: "POST",
      body: { email },
      signal,
      expectJson: false,
    })
  }

  async verifySignInCode(email: string, code: string, signal?: AbortSignal): Promise<AuthResult> {
    const result = await this.request<AuthResult>(`${this.endpoints.authBaseUrl}/v1/auth/sign-in/code/verify`, {
      method: "POST",
      body: { email, code },
      signal,
    })
    if (!result.token?.trim()) throw new Error("AI/ML API did not return an auth token.")
    return result
  }

  async createPasswordlessAccount(email: string, signal?: AbortSignal): Promise<AuthResult> {
    const result = await this.request<AuthResult>(`${this.endpoints.authBaseUrl}/v1/auth/account/passwordless`, {
      method: "POST",
      body: { email },
      signal,
    })
    if (!result.token?.trim()) throw new Error("AI/ML API did not return an auth token.")
    return result
  }

  async createKey(bearer: string, name: string, signal?: AbortSignal): Promise<CreatedKey> {
    const result = await this.request<CreatedKey>(`${this.endpoints.appBaseUrl}/v1/keys`, {
      method: "POST",
      bearer,
      body: name.trim() ? { name: name.trim() } : {},
      signal,
    })
    if (!result.key?.trim()) throw new Error("AI/ML API did not return an API key.")
    return result
  }

  /** Also serves as the pasted-key validation probe (S3). */
  async getBalance(apiKey: string, signal?: AbortSignal): Promise<BalanceResult> {
    const url = `${this.endpoints.inferenceBaseUrl.replace(/\/+$/, "")}/billing/balance`
    const result = await this.request<unknown>(url, { method: "GET", bearer: apiKey, signal })
    if (!isBalanceResult(result)) {
      throw new AimlapiApiError(`GET ${requestLabel(url)} returned invalid balance response`, 200, "")
    }
    return result
  }

  async createSession(
    input: { partnerId: string; partnerName?: string | null; returnUrl?: string | null },
    signal?: AbortSignal,
  ): Promise<PartnerCheckoutSession> {
    return this.request<PartnerCheckoutSession>(`${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions`, {
      method: "POST",
      body: {
        partnerId: input.partnerId,
        ...(input.partnerName ? { partnerName: input.partnerName } : {}),
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      },
      signal,
    })
  }

  async getSession(sessionToken: string, signal?: AbortSignal): Promise<PartnerCheckoutSession> {
    return this.request<PartnerCheckoutSession>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}`,
      { method: "GET", signal },
    )
  }

  async pay(
    bearer: string,
    sessionToken: string,
    input: {
      amountUsdMinor: number
      paymentSessionId: string
      successUrl?: string
      cancelUrl?: string
      autoTopUp?: boolean
    },
    signal?: AbortSignal,
  ): Promise<PayResult> {
    return this.request<PayResult>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/pay`,
      {
        method: "POST",
        bearer,
        body: {
          amountUsdMinor: input.amountUsdMinor,
          paymentSessionId: input.paymentSessionId,
          method: "card",
          ...(input.successUrl ? { successUrl: input.successUrl } : {}),
          ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
          ...(input.autoTopUp ? { autoTopUp: true } : {}),
        },
        signal,
      },
    )
  }

  async exchange(bearer: string, sessionToken: string, signal?: AbortSignal): Promise<ExchangeResult> {
    return this.request<ExchangeResult>(
      `${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/exchange`,
      { method: "POST", bearer, signal },
    )
  }

  private async request<T>(
    url: string,
    options: {
      method: "GET" | "POST" | "PATCH"
      body?: unknown
      bearer?: string
      signal?: AbortSignal
      expectJson?: boolean
    },
  ): Promise<T> {
    const label = requestLabel(url)
    // Attribution headers (source: agent + partner id) belong on every call, not
    // just sign-up — set here so no endpoint method can forget them.
    const headers: Record<string, string> = { Accept: "application/json", ...aimlapiAttributionHeaders() }
    if (options.body !== undefined) headers["Content-Type"] = "application/json"
    if (options.bearer) headers["Authorization"] = `Bearer ${options.bearer.trim()}`

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      const reason = redactRequestSecrets(error instanceof Error ? error.message : String(error), url, options.bearer)
      throw new AimlapiApiError(`Network request to ${label} failed: ${reason}`, 0, "")
    }

    let text: string
    try {
      text = await readResponseText(response)
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (error instanceof AimlapiApiError) throw error
      const reason = redactRequestSecrets(error instanceof Error ? error.message : String(error), url, options.bearer)
      throw new AimlapiApiError(`Network response from ${label} failed: ${reason}`, 0, "")
    }

    if (!response.ok) {
      throw new AimlapiApiError(`${options.method} ${label} -> ${response.status}`, response.status, text)
    }
    if (!text.trim()) {
      if (options.expectJson === false) return undefined as T
      throw new AimlapiApiError(`${options.method} ${label} returned empty body`, response.status, "")
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new AimlapiApiError(`${options.method} ${label} returned non-JSON body`, response.status, text)
    }
  }
}
