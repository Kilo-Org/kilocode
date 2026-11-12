export * as PagesAuth from "./auth"

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>

/** The one header the `pages` MCP entry carries. It is a lookup key for a binding, not a credential. */
export const HANDLE_HEADER = "x-kilo-pages-handle"

export interface Binding {
  /** The only origin the token may be sent to. */
  readonly origin: string
  /** Value of `X-Pages-Client`. */
  readonly client: string
  /**
   * A bearer for one request, or undefined when there is none (signed out, disabled, refused). `rejected` is a token
   * Pages refused, so the binding can mint a fresh one.
   */
  readonly token: (rejected?: string) => Promise<string | undefined>
}

// Process-global: the host builds one MCP service for every Location, so its fetch hook sees no Location. Each Pages
// plugin instance registers the binding of its Location under a random handle and puts the handle on its entry.
const bindings = new Map<string, Binding>()

export function register(handle: string, binding: Binding) {
  bindings.set(handle, binding)
  return () => {
    if (bindings.get(handle) === binding) bindings.delete(handle)
  }
}

// Wraps the transport fetch of every MCP server. A request without the handle is not touched. With it, the wrapper
// strips the handle, refuses any origin but the binding's, adds the Authorization and client headers, never
// follows a redirect itself (the SDK re-enters this wrapper for each hop, so every hop is origin-checked), and
// retries once on a 401 with a fresh token.
export function wrap(next: Fetch): Fetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers)
    const handle = headers.get(HANDLE_HEADER)
    if (handle === null) return next(url, init)
    headers.delete(HANDLE_HEADER)

    const binding = bindings.get(handle)
    if (!binding || new URL(String(url)).origin !== binding.origin) return unauthorized()
    // An Authorization header that is already there is the user's own and stays untouched.
    if (headers.has("authorization")) return next(url, { ...init, headers, redirect: "manual" })

    headers.set("X-Pages-Driver", "Kilo")
    headers.set("X-Pages-Client", binding.client)

    const send = (token: string) => {
      const authorized = new Headers(headers)
      authorized.set("Authorization", `Bearer ${token}`)
      return next(url, { ...init, headers: authorized, redirect: "manual" })
    }
    const token = await binding.token()
    if (!token) return unauthorized()
    const response = await send(token)
    if (response.status !== 401) return response
    await response.body?.cancel()
    // A streaming body is spent after the first attempt, so only a replayable body is sent again.
    if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") return unauthorized()
    const fresh = await binding.token(token)
    if (!fresh || fresh === token) return unauthorized()
    const retried = await send(fresh)
    if (retried.status !== 401) return retried
    await retried.body?.cancel()
    return unauthorized()
  }
}

// A fixed body, so a client maps one stable message and never an echo of what Pages or Kilo said.
function unauthorized() {
  return new Response("Pages rejected the Kilo credential", { status: 401, headers: { "content-type": "text/plain" } })
}
