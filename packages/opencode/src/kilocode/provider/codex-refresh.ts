import { Flock } from "@opencode-ai/core/util/flock"

export class CodexAuthExpiredError extends Error {
  constructor(
    message = "Your ChatGPT sign-in expired or was revoked. Sign in with ChatGPT again to continue using Codex models.",
  ) {
    super(message)
    this.name = "CodexAuthExpiredError"
  }
}

type Auth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

type Tokens = {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type Input = {
  input: {
    client: {
      auth: {
        set: (input: { path: { id: string }; body: Auth }) => Promise<unknown>
      }
    }
  }
  getAuth: () => Promise<unknown>
  auth: Auth
  refresh: (refresh: string, signal: AbortSignal) => Promise<Tokens>
  account: (tokens: Tokens) => string | undefined
  lock?: Flock.Options
  timeout?: number
}

const pending = new Map<string, Promise<Auth>>()
const lock = "codex-auth-refresh:openai"
const timeout = 30_000

function valid(auth: Auth) {
  return auth.access && auth.expires > Date.now()
}

function usable(auth: Auth, refresh: string) {
  return auth.refresh !== refresh || valid(auth)
}

function oauth(auth: unknown): Auth | undefined {
  if (!auth || typeof auth !== "object" || !("type" in auth) || auth.type !== "oauth") return
  return auth as Auth
}

function assign(auth: Auth, next: Auth) {
  auth.access = next.access
  auth.refresh = next.refresh
  auth.expires = next.expires
  auth.accountId = next.accountId
}

function recoverable(err: unknown) {
  return err instanceof Error && /^Token refresh failed: 401\b/.test(err.message)
}

export async function refreshCodexAuth(input: Input) {
  const token = input.auth.refresh
  const inflight = pending.get(token)
  if (inflight) {
    const next = await inflight
    assign(input.auth, next)
    return next
  }

  const promise = Flock.withLock(
    lock,
    async () => {
      const fresh = await input.getAuth()
      const current = oauth(fresh)
      if (current && valid(current)) return current

      try {
        const base = current && current.refresh !== token ? current : input.auth
        const controller = new AbortController()
        const timer = setTimeout(
          () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
          input.timeout ?? timeout,
        )
        const tokens = await input.refresh(base.refresh, controller.signal).finally(() => clearTimeout(timer))
        const id = input.account(tokens) || base.accountId
        const next = {
          type: "oauth" as const,
          refresh: tokens.refresh_token,
          access: tokens.access_token,
          expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          ...(id && { accountId: id }),
        }
        await input.input.client.auth.set({ path: { id: "openai" }, body: next })
        return next
      } catch (err) {
        if (!recoverable(err)) throw err

        const latest = await input.getAuth()
        const next = oauth(latest)
        if (next && usable(next, token)) return next

        throw new CodexAuthExpiredError()
      }
    },
    input.lock,
  ).finally(() => pending.delete(token))

  pending.set(token, promise)
  const next = await promise
  assign(input.auth, next)
  return next
}
