// kilocode_change - new file
//
// AI/ML API guided-onboarding flow controller (UI-agnostic state machine).
//
// Screens map to the shared AIMLAPI onboarding spec:
//   choice (S2) -> paste-key (S3) | email (S4) -> code (S10) | credits (S5)
//   -> checkout (S6) -> topup-success (S7) -> ready (S11); reconfigure (S12).
//
// The TUI component renders phases and forwards user input; all HTTP,
// validation, retry-idempotency and error-copy logic lives here so it can be
// unit-tested without a terminal.

import {
  DEFAULT_AMOUNT_USD_MINOR,
  DEFAULT_PARTNER_ID,
  DEFAULT_PARTNER_NAME,
  ISSUED_KEY_NAME,
  MAX_AMOUNT_USD_MINOR,
  MIN_AMOUNT_USD_MINOR,
  buildPartnerCheckoutReturnUrls,
  buildPartnerReturnUrl,
  resolveEndpoints,
} from "./config"
import { AimlapiApiError, AimlapiClient, type PartnerCheckoutSession } from "./client"

/** Amount pre-filled on the credits screen, derived from the shared minor default. */
export const DEFAULT_AMOUNT_USD_DISPLAY = String(DEFAULT_AMOUNT_USD_MINOR / 100)

// Copy deck — keep verbatim with the shared spec / Figma mockups.
export const COPY = {
  choiceTitle: "Do you have aimlapi.com key?",
  choiceNewUser: "I am a new user",
  choiceHaveKey: "I already have aimlapi.com key",
  pasteKeyTitle: "Enter your aimlapi.com key.",
  pasteKeyPlaceholder: "Paste your key...",
  errInvalidKey: "API key is invalid. Please make sure you enter a valid aimlapi.com key.",
  emailTitle: "Enter your email.",
  emailPlaceholder: "you@example.com",
  errEmailFormat: "Email format is incorrect.",
  codeTitle: (email: string) => `Enter the 6-digit code sent to ${email}.`,
  codePlaceholder: "123456",
  errCodeWrong: "Code is incorrect.",
  errCodeExpired: "Invalid or expired code",
  creditsTitle: "Add credits (min $20).",
  creditsAutoTopUp: "Auto top-up",
  errAmountMissing: "Please enter a top-up amount.",
  errAmountMin: "Minimum top-up is $20.",
  errTopupFailed: "Top up failed. Please try again.",
  checkoutTitle: "Opening checkout in browser...",
  checkoutBody: "If the browser did not open automatically please use this link to top up your account:",
  topupSuccessTitle: (amountUsd: string) => `Top-up successful - $${amountUsd} credited to your account`,
  topupSuccessBody: (email: string) =>
    `We’ve emailed you a magic link to ${email}. Use it to access your aimlapi.com account and review your usage.`,
  readyTitle: "Everything is ready.",
  reconfigureTitle: "aimlapi.com account is already configured",
  reconfigureContinue: "Continue with your saved API key",
  reconfigureNewKey: "Set up a new key or switch account",
} as const

export type FlowPhase =
  | { id: "choice" }
  | { id: "paste-key"; error?: string }
  | { id: "email"; error?: string }
  | { id: "code"; email: string; error?: string }
  | { id: "credits"; error?: string }
  | { id: "checkout"; payUrl: string | null }
  | { id: "topup-success"; amountUsd: string; email: string }
  | { id: "ready" }
  | { id: "reconfigure" }
  | { id: "busy"; message: string }

export type FlowResult = { apiKey: string; apiKeyId?: string }

export type FlowDeps = {
  client?: AimlapiClient
  /** Open a URL in the user's browser. */
  openUrl: (url: string) => Promise<void>
  change: (phase: FlowPhase) => void
  /** Terminal success: persist the key and move to the model picker. */
  complete: (result: FlowResult) => void
  now?: () => number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 20 * 60 * 1000

export function parseAmountUsd(input: string): { ok: true; usdMinor: number } | { ok: false; error: string } {
  const raw = input.trim().replace(/^\$/, "")
  if (!raw) return { ok: false, error: COPY.errAmountMissing }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: COPY.errAmountMissing }
  const usdMinor = Math.round(value * 100)
  if (usdMinor < MIN_AMOUNT_USD_MINOR) return { ok: false, error: COPY.errAmountMin }
  if (usdMinor > MAX_AMOUNT_USD_MINOR) return { ok: false, error: COPY.errTopupFailed }
  return { ok: true, usdMinor }
}

export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

function formatUsd(usdMinor: number): string {
  const dollars = usdMinor / 100
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * One onboarding attempt. Created per dialog; retains checkout idempotency
 * state (paymentSessionId + resume token) for the lifetime of the dialog so
 * retries never create a duplicate charge.
 */
export class AimlapiFlow {
  private readonly endpoints = resolveEndpoints()
  private readonly client: AimlapiClient
  private readonly abort = new AbortController()

  private email = ""
  private authToken = ""
  /** Idempotency handle: stable per (amount, autoTopUp) intent. */
  private paymentSessionId = ""
  private intentKey = ""
  private checkoutSessionToken = ""

  constructor(private readonly deps: FlowDeps) {
    this.client = deps.client ?? new AimlapiClient(this.endpoints)
  }

  get signal(): AbortSignal {
    return this.abort.signal
  }

  cancel() {
    this.abort.abort()
  }

  start(alreadyConfigured: boolean) {
    this.deps.change(alreadyConfigured ? { id: "reconfigure" } : { id: "choice" })
  }

  chooseHaveKey() {
    this.deps.change({ id: "paste-key" })
  }

  chooseNewUser() {
    this.deps.change({ id: "email" })
  }

  chooseReconfigure() {
    this.deps.change({ id: "choice" })
  }

  /** S3: validate the pasted key with a live balance probe, then finish. */
  async submitKey(raw: string) {
    const key = raw.trim()
    if (!key) {
      this.deps.change({ id: "paste-key", error: COPY.errInvalidKey })
      return
    }
    this.deps.change({ id: "busy", message: "Validating key..." })
    try {
      await this.client.getBalance(key, this.signal)
    } catch (error) {
      if (this.signal.aborted) return
      // A 401/403 is the real "bad key" signal; anything else (network,
      // timeout, 5xx) is a transport/service failure and must not be blamed
      // on the key the user pasted.
      const invalidKey = error instanceof AimlapiApiError && (error.status === 401 || error.status === 403)
      this.deps.change({ id: "paste-key", error: invalidKey ? COPY.errInvalidKey : this.describe(error) })
      return
    }
    this.deps.change({ id: "ready" })
    this.deps.complete({ apiKey: key })
  }

  /** S4: branch on account existence (backend decides). */
  async submitEmail(raw: string) {
    const email = raw.trim().toLowerCase()
    if (!validEmail(email)) {
      this.deps.change({ id: "email", error: COPY.errEmailFormat })
      return
    }
    this.email = email
    this.deps.change({ id: "busy", message: "Checking account..." })
    try {
      const account = await this.client.checkAccount(email, this.signal)
      if (account.action === "sign-in") {
        await this.client.sendSignInCode(email, this.signal)
        this.deps.change({ id: "code", email })
        return
      }
      const auth = await this.client.createPasswordlessAccount(email, this.signal)
      this.authToken = auth.token
      this.deps.change({ id: "credits" })
    } catch (error) {
      if (this.signal.aborted) return
      this.deps.change({ id: "email", error: this.describe(error) })
    }
  }

  /** S10: verify the 6-digit code, issue a key, finish. */
  async submitCode(raw: string) {
    const code = raw.trim()
    if (!/^\d{6}$/.test(code)) {
      this.deps.change({ id: "code", email: this.email, error: COPY.errCodeWrong })
      return
    }
    this.deps.change({ id: "busy", message: "Verifying code..." })
    try {
      const auth = await this.client.verifySignInCode(this.email, code, this.signal)
      this.authToken = auth.token
      const created = await this.client.createKey(this.authToken, ISSUED_KEY_NAME, this.signal)
      this.deps.change({ id: "ready" })
      this.deps.complete({ apiKey: created.key, apiKeyId: created.id })
    } catch (error) {
      if (this.signal.aborted) return
      if (error instanceof AimlapiApiError && error.status >= 400 && error.status < 500) {
        const expired = error.body.toLowerCase().includes("expired")
        this.deps.change({
          id: "code",
          email: this.email,
          error: expired ? COPY.errCodeExpired : COPY.errCodeWrong,
        })
        return
      }
      this.deps.change({ id: "code", email: this.email, error: this.describe(error) })
    }
  }

  /** S5 -> S6 -> S7: create checkout, open browser, poll, exchange the key. */
  async submitAmount(rawAmount: string, autoTopUp: boolean) {
    const parsed = parseAmountUsd(rawAmount)
    if (!parsed.ok) {
      this.deps.change({ id: "credits", error: parsed.error })
      return
    }
    if (!this.authToken) {
      this.deps.change({ id: "email", error: COPY.errTopupFailed })
      return
    }
    // Same intent -> same paymentSessionId, so a retry can never double-charge.
    const intentKey = `${parsed.usdMinor}:${autoTopUp}`
    if (this.intentKey !== intentKey || !this.paymentSessionId) {
      this.intentKey = intentKey
      this.paymentSessionId = crypto.randomUUID()
    }

    this.deps.change({ id: "busy", message: "Creating checkout session..." })
    try {
      if (!this.checkoutSessionToken) {
        const session = await this.client.createSession(
          {
            partnerId: DEFAULT_PARTNER_ID,
            partnerName: DEFAULT_PARTNER_NAME,
            returnUrl: buildPartnerReturnUrl(this.endpoints.verificationBaseUrl),
          },
          this.signal,
        )
        this.checkoutSessionToken = session.sessionToken
      }

      const returnUrls = buildPartnerCheckoutReturnUrls(this.endpoints.payBaseUrl, this.checkoutSessionToken)
      const { checkout } = await this.client.pay(
        this.authToken,
        this.checkoutSessionToken,
        {
          amountUsdMinor: parsed.usdMinor,
          paymentSessionId: this.paymentSessionId,
          ...returnUrls,
          autoTopUp,
        },
        this.signal,
      )

      this.deps.change({ id: "checkout", payUrl: checkout.payUrl })
      if (checkout.payUrl) {
        await this.deps.openUrl(checkout.payUrl).catch(() => {})
      }

      const paid = await this.pollUntilPaid(this.checkoutSessionToken)
      if (!paid) return

      this.deps.change({ id: "busy", message: "Issuing your API key..." })
      const exchanged = await this.client.exchange(this.authToken, this.checkoutSessionToken, this.signal)

      this.deps.change({ id: "topup-success", amountUsd: formatUsd(parsed.usdMinor), email: this.email })
      this.deps.complete({ apiKey: exchanged.apiKey, apiKeyId: exchanged.apiKeyId })
    } catch (error) {
      if (this.signal.aborted) return
      this.deps.change({ id: "credits", error: this.describe(error, COPY.errTopupFailed) })
    }
  }

  private async pollUntilPaid(sessionToken: string): Promise<PartnerCheckoutSession | undefined> {
    const started = (this.deps.now ?? Date.now)()
    const interval = this.deps.pollIntervalMs ?? POLL_INTERVAL_MS
    const timeout = this.deps.pollTimeoutMs ?? POLL_TIMEOUT_MS
    while (true) {
      if ((this.deps.now ?? Date.now)() - started > timeout) {
        this.deps.change({ id: "credits", error: COPY.errTopupFailed })
        return undefined
      }
      await sleep(interval, this.signal)
      let session: PartnerCheckoutSession
      try {
        session = await this.client.getSession(sessionToken, this.signal)
      } catch (error) {
        if (this.signal.aborted) throw error
        continue // transient poll errors are retried until the timeout
      }
      if (session.status === "paid" || session.status === "exchanging" || session.status === "exchanged") {
        return session
      }
      if (session.status === "cancelled" || session.status === "expired" || session.status === "failed") {
        // Terminal checkout failure: the session token is spent.
        this.checkoutSessionToken = ""
        this.deps.change({ id: "credits", error: COPY.errTopupFailed })
        return undefined
      }
    }
  }

  private describe(error: unknown, fallback?: string): string {
    if (error instanceof AimlapiApiError) {
      if (error.status === 0) return "Network error. Please check your connection and try again."
      return fallback ?? `AI/ML API request failed (${error.status}). Please try again.`
    }
    if (fallback) return fallback
    return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again."
  }
}
