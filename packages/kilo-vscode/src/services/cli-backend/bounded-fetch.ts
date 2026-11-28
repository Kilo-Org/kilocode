// Bounded fetch for CLI backend traffic (#16497).
//
// The generated SDK client sets `timeout: false`, so without this wrapper a
// wedged CLI (blocked event loop or a wedged SQLite driver) makes every
// database-backed request hang forever: the webview button animates but its
// IPC handler never settles. The connection watchdog restarts the CLI process
// in that case, but if recovery itself fails, nothing else ever unblocks the
// waiting callers. This wrapper gives every request a finite budget.
//
// Only the fetch settlement (response headers) is bounded. SSE streams and
// response bodies are not affected once headers have arrived. Endpoints whose
// legitimate work exceeds the budget (full agent command runs, compact,
// retention VACUUM, human-in-the-loop MCP OAuth, instance reload) opt out with
// the {@link CLI_REQUEST_TIMEOUT_HEADER} request header.

export const DEFAULT_CLI_REQUEST_TIMEOUT_MS = 60_000

export const CLI_REQUEST_TIMEOUT_HEADER = "x-kilo-cli-timeout"
export const CLI_REQUEST_TIMEOUT_NONE = "none"

export class CliRequestTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(
      `CLI request timed out after ${timeoutMs}ms: ${url}. The backend may be unresponsive; the health watchdog restarts it automatically if the wedge is confirmed.`,
    )
    this.name = "CliRequestTimeoutError"
  }
}

export interface BoundedFetchOptions {
  readonly timeoutMs?: number
  readonly fetchImpl?: BunFetch
}

// Bun's fetch types do not declare its `timeout` option; it disables Bun's own
// default request timeout so long-poll/SSE calls are not cut off by the runtime.
type BunFetchInit = RequestInit & { timeout?: false; duplex?: "half" }

// The extension host and Bun both accept the non-standard `duplex`/`timeout`
// options, but the DOM RequestInit types do not declare them.
type BunFetch = (input: RequestInfo | URL, init?: BunFetchInit) => Promise<Response>

function passthroughInit(init?: RequestInit): BunFetchInit {
  return { ...init, duplex: "half", timeout: false }
}

function withoutTimeoutHeader(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  headers.delete(CLI_REQUEST_TIMEOUT_HEADER)
  return headers
}

/**
 * Build a fetch-compatible function that aborts CLI requests which do not
 * settle within `timeoutMs`, while preserving a caller-provided AbortSignal and
 * the SDK's `duplex`/`timeout: false` transport options. String/URL callers keep
 * their original `(input, init)` shape (only the signal is replaced) so raw fetch
 * call sites and their contracts stay byte-identical apart from the bound.
 */
export function createBoundedCliFetch(options: BoundedFetchOptions = {}): typeof fetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_REQUEST_TIMEOUT_MS
  // Resolve the global fetch at call time, not construction time: tests replace globalThis.fetch
  // per case, and runtime wrappers (VS Code proxy-agent) may patch it after activation.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion - BunFetchInit carries runtime-only duplex/timeout options
  const fetchImpl: BunFetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init as RequestInit))

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init)

    if (request.headers.get(CLI_REQUEST_TIMEOUT_HEADER) === CLI_REQUEST_TIMEOUT_NONE) {
      // Rebuild rather than `new Request(request, { headers })`: Bun ignores a headers replacement
      // when cloning a single-header Request, which would leak the internal marker.
      const headers = withoutTimeoutHeader(init)
      if (input instanceof Request) {
        const requestInit: BunFetchInit = { method: input.method, headers, body: input.body, duplex: "half" }
        return fetchImpl(new Request(input.url, requestInit), {
          duplex: "half",
          timeout: false,
        })
      }
      return fetchImpl(input, passthroughInit({ ...init, headers }))
    }

    if (request.signal.aborted) {
      return fetchImpl(input, passthroughInit(init))
    }

    let timedOut = false
    const controller = new AbortController()
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    timer.unref?.()

    const forwardAbort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener("abort", forwardAbort, { once: true })

    // Settle the race from the abort signal itself, not from fetch rejecting: a transport that
    // ignores abort (or a never-settling stub in tests) must still unblock the caller on timeout.
    const abortFailure = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          if (timedOut) {
            reject(new CliRequestTimeoutError(request.url, timeoutMs))
            return
          }
          reject(request.signal.reason ?? new DOMException("The operation was aborted.", "AbortError"))
        },
        { once: true },
      )
    })

    const cleanup = () => {
      clearTimeout(timer)
      request.signal.removeEventListener("abort", forwardAbort)
    }

    const call =
      input instanceof Request
        ? fetchImpl(new Request(input, { signal: controller.signal }), passthroughInit())
        : fetchImpl(input, passthroughInit({ ...init, signal: controller.signal }))

    return Promise.race([call, abortFailure]).finally(cleanup)
  }
}

// Shared instance for raw fetch call sites that talk to the local CLI.
let defaultBoundedFetch: typeof fetch | undefined

export function boundedCliFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  defaultBoundedFetch ??= createBoundedCliFetch()
  return defaultBoundedFetch(input, init)
}
