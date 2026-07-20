// Helper for materializing remote-session file attachments on the CLI side.
//
// Mobile uploads bytes to R2 and sends the CLI a first-class
// `FilePartInput = { id?, type: 'file', mime, filename?, url }` whose `url`
// is an HTTPS R2 presigned GET and whose `filename` is the server-issued
// `<uuid>.<ext>` basename. The CLI must fetch those bytes and turn the part
// into a shape the existing `resolvePart` boundary can consume:
//
//   - text/*, image/*, application/pdf → emit a `data:` URL file part
//     (text canonicalizes to `text/plain`; PDF and image pass through to the
//     existing PDF model modality / image normalization paths in
//     `provider/transform.ts` and `resolvePart`)
//   - any other extension → write to a per-session scratch directory and
//     emit a synthetic text part describing the absolute path, filename,
//     MIME, and size
//
// The helper is invoked only from `remote-sender.ts`; local prompts and
// other ingress paths never touch this code (decision 6).
import path from "node:path"
import fs from "node:fs/promises"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "remote-attachments" })

export namespace RemoteAttachments {
  // Decision 4: canonical extension → MIME table. Text entries all
  // canonicalize to `text/plain` at re-entry (per text caveat in the
  // design). The binary fallback is `application/octet-stream` and is
  // applied to any extension not present here AND to extensionless inputs.
  export const EXTENSION_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/plain",
    csv: "text/plain",
    log: "text/plain",
    json: "text/plain",
    xml: "text/plain",
    yaml: "text/plain",
    yml: "text/plain",
    toml: "text/plain",
    ini: "text/plain",
    html: "text/plain",
    css: "text/plain",
    js: "text/plain",
    jsx: "text/plain",
    ts: "text/plain",
    tsx: "text/plain",
    py: "text/plain",
    rb: "text/plain",
    go: "text/plain",
    rs: "text/plain",
    java: "text/plain",
    c: "text/plain",
    h: "text/plain",
    cpp: "text/plain",
    hpp: "text/plain",
    sh: "text/plain",
    sql: "text/plain",
  }
  export const BINARY_MIME = "application/octet-stream"
  export const TEXT_PLAIN = "text/plain"
  // Hard cap on attachment bytes (5 MB + 1 byte so the helper aborts
  // strictly when the body exceeds the agreed ceiling).
  export const MAX_BYTES = 5 * 1024 * 1024 + 1
  // Per-attachment fetch budget. R2 presigned GETs in the same region
  // complete in tens of ms; 15s is generous but bounded so a stalled
  // connection can never hold the prompt open indefinitely.
  export const FETCH_TIMEOUT_MS = 15_000
  export const SCRATCH_DIRNAME = "remote-attachments"

  export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

  export type Deps = {
    sessionID: SessionID
    /** Override the scratch root. Defaults to `Global.Path.tmp`. */
    tmpRoot?: string
    /** Override `fetch` (used to inject mock responses in tests). */
    fetch?: Fetcher
    /** Per-call logger. Defaults to the module logger. */
    log?: {
      warn: (msg: string, meta?: unknown) => void
      error: (msg: string, meta?: unknown) => void
    }
  }

  export type MaterializedPart = { type: "text"; text: string } | MaterializedFilePart

  export type MaterializedFilePart = {
    id?: string
    type: "file"
    mime: string
    filename?: string
    url: string
    source?: { type: "remote"; url: string }
  }

  export type Result = {
    materialize: (parts: readonly any[]) => Promise<any[]>
    dispose: () => Promise<void>
  }

  /** Extract the lowercased extension from a server-issued basename. */
  export function extensionOf(filename: string | undefined): string {
    if (!filename) return "bin"
    const i = filename.lastIndexOf(".")
    if (i < 0 || i === filename.length - 1) return "bin"
    return filename.slice(i + 1).toLowerCase()
  }

  /** Return the canonical MIME for the given extension. */
  export function mimeFor(extension: string): string {
    return EXTENSION_MIME[extension] ?? BINARY_MIME
  }

  /**
   * Validate that an extension is a safe single token usable as a file
   * suffix. Anything that would expand to a path segment beyond a single
   * component is rejected and falls back to "bin" at the call site.
   */
  export function safeExtension(extension: string): string {
    return /^[A-Za-z0-9]{1,16}$/.test(extension) ? extension : "bin"
  }

  /** Classify by extension. Equivalent to `mimeFor(extensionOf(filename))`. */
  export function classify(filename: string | undefined): { mime: string; extension: string } {
    const ext = safeExtension(extensionOf(filename))
    return { mime: mimeFor(ext), extension: ext }
  }

  /** True when the URL points at an http(s) resource we should fetch. */
  export function isFetchable(url: string): boolean {
    return /^https?:\/\//i.test(url)
  }

  /** Reason a fetch failed. */
  export type FetchError = {
    kind: "https" | "redirect" | "non-2xx" | "overflow" | "timeout" | "network"
    message: string
    status?: number
  }

  function makeError(kind: FetchError["kind"], message: string, status?: number): FetchError & Error {
    const e = new Error(message) as Error & FetchError
    e.kind = kind
    if (status !== undefined) e.status = status
    return e
  }

  async function readBounded(response: Response, signal: AbortSignal): Promise<Uint8Array> {
    const body = response.body
    if (!body) return new Uint8Array()
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total >= MAX_BYTES) {
          try {
            await reader.cancel()
          } catch {
            // best-effort: the read is already failing the bound
          }
          throw makeError("overflow", `attachment exceeds ${MAX_BYTES - 1} bytes`)
        }
        chunks.push(value)
      }
    } catch (err) {
      if (err && typeof err === "object" && "kind" in err) throw err
      if (signal.aborted) {
        throw makeError("timeout", "attachment fetch timed out")
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw makeError("network", `attachment fetch failed: ${msg}`)
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // reader already detached; nothing to do
      }
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  }

  /**
   * Fetch a single R2 presigned URL with the full decision-6 safety net:
   *   - HTTPS only
   *   - redirects rejected
   *   - no credentials forwarded
   *   - body bounded to 5 MB + 1 byte
   *   - bounded timeout
   *   - non-2xx rejected
   */
  export async function fetchOne(url: string, deps?: { fetch?: Fetcher; timeoutMs?: number }): Promise<Uint8Array> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw makeError("https", `attachment url is not a valid URL: ${url}`)
    }
    if (parsed.protocol !== "https:") {
      throw makeError("https", `attachment url must use https (got ${parsed.protocol.replace(":", "")})`)
    }
    const f = deps?.fetch ?? (globalThis.fetch as Fetcher | undefined)
    if (!f) throw makeError("network", "no fetch implementation available")
    const controller = new AbortController()
    const timeoutMs = deps?.timeoutMs ?? FETCH_TIMEOUT_MS
    const timer = setTimeout(() => controller.abort(new DOMException("timeout", "AbortError")), timeoutMs)
    let response: Response
    try {
      response = await f(url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw makeError("timeout", `attachment fetch timed out after ${timeoutMs}ms`)
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (/redirect/i.test(msg)) {
        throw makeError("redirect", `attachment url redirected: ${msg}`)
      }
      throw makeError("network", `attachment fetch failed: ${msg}`)
    } finally {
      clearTimeout(timer)
    }
    if (response.status < 200 || response.status >= 300) {
      throw makeError("non-2xx", `attachment fetch returned ${response.status}`, response.status)
    }
    return readBounded(response, controller.signal)
  }

  /** Build the explanatory text part that replaces a failed attachment. */
  export function failureText(filename: string | undefined, reason: string): { type: "text"; text: string } {
    const name = filename ?? "attachment"
    return {
      type: "text",
      text: `attachment ${name} could not be retrieved: ${reason}`,
    }
  }

  /**
   * Materialize a list of parts. Non-file parts are passed through
   * unchanged. File parts whose URL is http(s) are fetched and replaced
   * with a data: URL file part (text/image/pdf) or a scratch-file text
   * part (binary). All other URL schemes (data:, file:, …) are passed
   * through unchanged so the existing `resolvePart` boundary can decide.
   * On any per-part failure the original part is replaced with an
   * explanatory text part and the rest of the prompt still proceeds.
   */
  export function create(deps: Deps): Result {
    const sessionID = deps.sessionID
    const root = deps.tmpRoot ?? Global.Path.tmp
    const scratchDir = path.join(root, SCRATCH_DIRNAME, sessionID)
    const writer = deps.log ?? {
      warn: (msg: string, meta?: unknown) => log.warn(msg, meta as never),
      error: (msg: string, meta?: unknown) => log.error(msg, meta as never),
    }
    const f = deps.fetch ?? (globalThis.fetch as Fetcher | undefined)
    let disposed = false
    const cleanup = async () => {
      try {
        await fs.rm(scratchDir, { recursive: true, force: true })
      } catch (err) {
        writer.warn("scratch dir cleanup failed", { sessionID, error: String(err) })
      }
    }
    // Best-effort: ensure the scratch dir exists so a concurrent first
    // write does not race. Failures are logged but do not block the
    // prompt — `materialize` retries on the per-part write path. The
    // session-scoped bus listener that fires `cleanup` on
    // Session.Event.Deleted is owned by the RemoteSender so the helper
    // has no implicit module-level side effects.
    void fs
      .mkdir(scratchDir, { recursive: true, mode: 0o700 })
      .catch((err) => writer.warn("scratch dir mkdir failed", { sessionID, error: String(err) }))

    const materialize = async (parts: readonly any[]): Promise<any[]> => {
      if (disposed) return [...parts]
      const out: any[] = []
      for (const part of parts) {
        if (!part || typeof part !== "object" || part.type !== "file") {
          out.push(part)
          continue
        }
        const url = typeof part.url === "string" ? part.url : ""
        if (!isFetchable(url)) {
          out.push(part)
          continue
        }
        const filename = typeof part.filename === "string" ? part.filename : undefined
        const { extension } = classify(filename)
        const id = typeof part.id === "string" && part.id.length > 0 ? part.id : crypto.randomUUID()
        const basename = `${id}.${extension}`
        const target = path.join(scratchDir, basename)
        try {
          const bytes = await fetchOne(url, { fetch: f })
          if (extension === "pdf") {
            // PDF falls through to the existing PDF modality
            // (`provider/transform.ts`); the helper hands it back as an
            // application/pdf file part with a data: URL.
            out.push({
              id,
              type: "file" as const,
              mime: "application/pdf",
              filename,
              url: dataUrl("application/pdf", bytes),
              source: { type: "remote" as const, url },
            })
            continue
          }
          if (mimeFor(extension) === BINARY_MIME) {
            // Binary fallback — persist to scratch and surface a text part.
            try {
              await fs.mkdir(scratchDir, { recursive: true, mode: 0o700 })
              await fs.writeFile(target, bytes, { mode: 0o600 })
            } catch (err) {
              writer.error("scratch write failed", { sessionID, error: String(err) })
              out.push(
                failureText(
                  filename,
                  `local write failed: ${err instanceof Error ? err.message : String(err)}`,
                ),
              )
              continue
            }
            out.push({
              type: "text" as const,
              text:
                `attachment saved to ${target} (filename: ${filename ?? basename}, mime: ${BINARY_MIME}, size: ${bytes.byteLength} bytes). ` +
                `Use the read tool on that path to inspect it.`,
            })
            continue
          }
          // text or image — re-enter as a data: URL.
          const mime = mimeFor(extension)
          out.push({
            id,
            type: "file" as const,
            mime,
            filename,
            url: dataUrl(mime, bytes),
            source: { type: "remote" as const, url },
          })
        } catch (err) {
          const reason =
            err && typeof err === "object" && "message" in err
              ? String((err as Error).message)
              : String(err)
          writer.warn("attachment fetch failed", { sessionID, filename, error: reason })
          out.push(failureText(filename, reason))
        }
      }
      return out
    }

    const dispose = async () => {
      if (disposed) return
      disposed = true
      await cleanup()
    }

    return { materialize, dispose }
  }

  /** Build a `data:` URL from a buffer. */
  export function dataUrl(mime: string, bytes: Uint8Array): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
  }

  /**
   * Best-effort removal of a session's scratch directory. The
   * RemoteSender registers a single Session.Event.Deleted listener that
   * dispatches here for the matching session id, so a session's scratch
   * state is reclaimed regardless of which ingress path triggered
   * deletion.
   */
  export async function cleanupSession(sessionID: SessionID, deps?: { tmpRoot?: string; log?: Deps["log"] }): Promise<void> {
    const dir = path.join(deps?.tmpRoot ?? Global.Path.tmp, SCRATCH_DIRNAME, sessionID)
    const writer = deps?.log ?? {
      warn: (msg: string, meta?: unknown) => log.warn(msg, meta as never),
      error: (msg: string, meta?: unknown) => log.error(msg, meta as never),
    }
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch (err) {
      writer.warn("scratch dir cleanup failed", { sessionID, error: String(err) })
    }
  }
}
