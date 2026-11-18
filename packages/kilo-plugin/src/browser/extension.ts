import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  IncompatibleError,
  NeedsPermissionError,
  UNAVAILABLE_MESSAGE,
  UnavailableError,
  UnsupportedError,
  type BrowserBackend,
  type CallContext,
  type CallResult,
  type ContentBlock,
} from "./backend"
import { BrowserContract } from "./contract"
import type { Entry } from "./contract-shape"
import { BrowserHub } from "./hub"
import { BrowserPermission } from "./permission"
import { takeStep } from "./steps"

/** The protocol version this CLI speaks. An extension that does not list it cannot be driven safely. */
export const PROTOCOL = 1

/** The setup step the UI shows while no extension is reachable, and the action the model relays to the user. */
export const EXTENSION_HINT =
  'Install the Kilo browser extension and turn on "Allow local agents" in its settings, or set browser.backend to "playwright".'

const HINT = EXTENSION_HINT

/** The update notice for an extension this CLI cannot drive. */
export const UPDATE_HINT = "Update the Kilo browser extension to the current version, then retry."

/**
 * How long a call waits for a connected extension before reporting it unavailable. A just-started hub and a
 * reconnect take a moment; a user without the extension should not wait out the transport's own timeout.
 */
const READY_TIMEOUT = 5_000

/** The upload chunk payload: base64 of this is exactly the protocol's `MaxUploadChunk`, so one frame always fits. */
const UPLOAD_CHUNK = 393_216

const CLASSES: Record<string, true> = { read: true, act: true, navigate: true, sensitive: true }

const MIME: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
}

/**
 * The grants the extension receives: the session's `<class>:<origin>` pairs, split back into the pairs the wire
 * carries. A pair the CLI cannot parse is dropped, never guessed at.
 */
export function grants(values: readonly string[]) {
  const pairs: { class: string; origin: string }[] = []
  for (const value of values) {
    const item = BrowserPermission.parse(value)
    if (item) pairs.push({ class: item.class, origin: item.origin })
  }
  return pairs
}

/**
 * The grants one error or result asks for. Anything the CLI cannot read is undefined, so a call that needs an
 * unknown permission is refused instead of left half-asked.
 */
export function needs(value: unknown): BrowserPermission.Item[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: BrowserPermission.Item[] = []
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return undefined
    const need = raw as Partial<BrowserHub.Need>
    if (typeof need.class !== "string" || CLASSES[need.class] !== true) return undefined
    if (typeof need.origin !== "string" || !need.origin) return undefined
    items.push({
      class: need.class as BrowserPermission.SensitiveClass,
      origin: need.origin,
      ...(need.frame === true ? { frame: true as const } : {}),
      ...(typeof need.reason === "string" ? { reason: need.reason } : {}),
    })
  }
  return items
}

/**
 * The result meta as the tool layer reads it, or undefined when the extension asked for a grant the CLI cannot
 * describe: the call then fails closed instead of answering with content it could not have granted.
 */
function finishMeta(meta: BrowserHub.Meta, stepToken?: string): CallResult["meta"] | undefined {
  const parsed = meta.needs === undefined ? undefined : needs(meta.needs)
  if (meta.needs !== undefined && parsed === undefined) return undefined
  return {
    ...(meta.url === undefined ? {} : { url: meta.url }),
    ...(meta.origin === undefined ? {} : { origin: meta.origin }),
    ...(meta.withheldFrames === undefined ? {} : { withheldFrames: meta.withheldFrames }),
    ...(parsed === undefined || parsed.length === 0 ? {} : { needs: parsed }),
    ...(stepToken === undefined ? {} : { stepToken }),
  }
}

const UNDESCRIBABLE = "The browser asked for permission the CLI cannot describe."

function reply(value: BrowserHub.Reply): CallResult {
  const content: ContentBlock[] = []
  for (const block of value.content) {
    if (block.type === "text") content.push({ type: "text", text: block.text })
    else if (block.type === "image") content.push({ type: "image", data: block.data, mimeType: block.mimeType })
  }
  const meta = value.meta === undefined ? undefined : finishMeta(value.meta)
  if (value.meta !== undefined && meta === undefined) {
    return { content: [{ type: "text", text: UNDESCRIBABLE }], isError: true }
  }
  return { content, isError: value.isError === true, ...(meta ? { meta } : {}) }
}

/**
 * One hub failure as the tool layer sees it. Transport states never reach the model text: the unavailable message is
 * the fixed sentence, and its setup step and its uncertainty marker travel in the error for the UI and the metadata.
 */
export function map(error: unknown): Error {
  if (
    error instanceof NeedsPermissionError ||
    error instanceof UnavailableError ||
    error instanceof UnsupportedError ||
    error instanceof IncompatibleError
  ) {
    return error
  }
  if (!(error instanceof BrowserHub.Failure)) return error instanceof Error ? error : new Error(String(error))
  switch (error.kind) {
    case "unavailable":
      return new UnavailableError(HINT, UNAVAILABLE_MESSAGE, { effectsUncertain: error.uncertain })
    case "permission": {
      const items = needs(error.items)
      if (items === undefined) return new Error("The browser asked for permission the CLI cannot describe.")
      return new NeedsPermissionError(items, error.stepToken)
    }
    case "moved": {
      const items = needs(error.items)
      if (items === undefined) return new Error("The browser asked for permission the CLI cannot describe.")
      if (items.length) return new NeedsPermissionError(items, error.stepToken)
      return new Error("The page changed before the step ran. Call the tool again.")
    }
    case "busy":
      return new Error("The tab is busy with another browser action. Try again in a moment.")
    case "taken":
      return new Error("Another Kilo surface took over the tab. The action did not run; try again.")
    case "stopped":
      return new Error("The user stopped this browser session.")
    case "unsupported":
      return new UnsupportedError()
    case "blocked":
      return new Error(error.message || "The browser refused this page.")
    case "mismatch":
      return new IncompatibleError("The Kilo browser extension is out of date for this version of Kilo.", UPDATE_HINT)
    default:
      return new Error(error.message || "The browser call failed.")
  }
}

/** The backend over one hub connection. `port` is undefined when the host serves no hub at all. */
export class ExtensionBackend implements BrowserBackend {
  readonly id = "extension" as const
  readonly contractSha = BrowserContract.sha256

  private readonly handles = new Map<string, Promise<string>>()
  private readonly sessions = new Map<string, string>()
  private listing: Promise<Set<string> | undefined> | undefined
  /** Whether this browser accepts file bytes; undefined until the first upload says so. */
  private transfer: boolean | undefined
  private readonly off: () => void

  constructor(private readonly input: { port?: BrowserHub.Port; directory: string }) {
    this.off =
      input.port?.onRevoked((event) => {
        const session = this.sessions.get(event.sessionHandle)
        if (session === undefined) return
        this.sessions.delete(event.sessionHandle)
        this.handles.delete(session)
      }) ?? (() => {})
  }

  /**
   * The tools this extension serves: the pinned contract, narrowed to the extension's own list when it was built
   * against a different contract (SPEC D14).
   */
  async listTools(): Promise<readonly Entry[]> {
    const names = await this.names().catch(() => undefined)
    if (names === undefined) return BrowserContract.entries
    return BrowserContract.entries.filter((entry) => names.has(entry.name))
  }

  async callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
    const port = this.input.port
    if (!port) throw new UnavailableError(HINT)
    try {
      const names = await this.names()
      if (names !== undefined && !names.has(name)) throw new UnsupportedError()
      const session = ctx.session ?? ""
      const handle = await this.handle(port, session)
      const input = name === "browser_file_upload" ? await this.upload(port, args) : args
      // A step token the user granted after an earlier action is spent here, on exactly this repeat of the step.
      const approved = ctx.sensitive !== undefined && ctx.sensitive.length ? [...ctx.sensitive] : undefined
      const step = approved === undefined ? takeStep(session, name, args) : undefined
      const remembered = approved ?? (step === undefined ? undefined : [step])
      const result = await port.call({
        sessionHandle: handle,
        name,
        arguments: input,
        authorized: grants(ctx.authorized ?? []),
        ...(remembered === undefined ? {} : { sensitive: remembered }),
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      })
      return reply(result)
    } catch (error) {
      // The action already ran and only its content was withheld: ask for the grants and never repeat the step.
      if (error instanceof BrowserHub.Failure && error.kind === "permission" && error.afterAction) {
        const items = needs(error.items)
        if (items === undefined) throw map(error)
        const meta = finishMeta(
          {
            ...(error.meta ?? {}),
            ...(items.length ? { needs: items } : {}),
          },
          error.stepToken,
        )
        return {
          content: [
            { type: "text", text: error.message || "The action ran; its content is withheld until the user approves." },
          ],
          isError: false,
          ...(meta ? { meta } : {}),
        }
      }
      throw map(error)
    }
  }

  /** Release the session's handle; a session the extension already dropped has nothing to close. */
  forget(session: string) {
    const handle = [...this.sessions].find(([, value]) => value === session)?.[0]
    const pending = this.handles.get(session)
    this.handles.delete(session)
    if (handle === undefined) return
    this.sessions.delete(handle)
    void pending?.then((value) => this.input.port?.close(value).catch(() => undefined))
  }

  /** The instance holds only per-session state; the hub connection belongs to the host. */
  async dispose() {
    this.off()
    this.handles.clear()
    this.sessions.clear()
  }

  /** A listing is cached once it succeeds; a failed attempt is dropped so the next call asks again. */
  private names(): Promise<Set<string> | undefined> {
    if (this.listing !== undefined) return this.listing
    const pending = this.load()
    this.listing = pending
    pending.catch(() => {
      if (this.listing === pending) this.listing = undefined
    })
    return pending
  }

  private async load(): Promise<Set<string> | undefined> {
    const port = this.input.port
    if (!port) return undefined
    const info = await this.ready(port)
    if (info.contractSha === this.contractSha) return undefined
    return new Set(await port.list())
  }

  private async ready(port: BrowserHub.Port): Promise<BrowserHub.Info> {
    const info = await port.ready(READY_TIMEOUT)
    if (!info.protocol.includes(PROTOCOL)) {
      throw new IncompatibleError(
        "The Kilo browser extension does not speak a protocol this CLI can drive.",
        UPDATE_HINT,
      )
    }
    return info
  }

  /** One session handle per tool session, opened once and shared by concurrent calls. */
  private handle(port: BrowserHub.Port, session: string): Promise<string> {
    const existing = this.handles.get(session)
    if (existing) return existing
    const opening = this.open(port, session)
    this.handles.set(session, opening)
    opening.catch(() => {
      if (this.handles.get(session) === opening) this.handles.delete(session)
    })
    return opening
  }

  private async open(port: BrowserHub.Port, session: string): Promise<string> {
    await this.ready(port)
    const opened = await port.open({
      sessionId: session || "unknown",
      title: session || "Kilo agent",
      cwd: this.input.directory,
    })
    // The session ended while the extension was still opening it: close the handle instead of keeping it alive.
    if (!this.handles.has(session)) {
      await port.close(opened.sessionHandle).catch(() => undefined)
      throw new Error("The session ended before its browser session opened.")
    }
    this.sessions.set(opened.sessionHandle, session)
    return opened.sessionHandle
  }

  /**
   * `browser_file_upload`'s local paths. A browser that accepts file bytes receives them in chunks and refers to them
   * by id; a browser that uploads through the page's own file chooser keeps the paths and needs no transfer, so the
   * first refusal turns the transfer off for this backend instead of failing the upload.
   */
  private async upload(port: BrowserHub.Port, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const paths = Array.isArray(args.paths)
      ? args.paths.filter((value): value is string => typeof value === "string")
      : []
    if (!paths.length || this.transfer === false) return args
    const uploads: string[] = []
    for (const file of paths) {
      const data = await fs.readFile(file).catch((error: unknown) => {
        throw new Error(
          `Cannot read ${file} for the upload: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      const uploadId = randomUUID()
      try {
        await port.begin({
          uploadId,
          name: path.basename(file),
          size: data.byteLength,
          mimeType: MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream",
        })
      } catch (error) {
        if (error instanceof BrowserHub.Failure && error.kind === "unsupported") {
          this.transfer = false
          return args
        }
        throw error
      }
      let index = 0
      for (let offset = 0; offset < data.byteLength; offset += UPLOAD_CHUNK) {
        await port.chunk({ uploadId, index, data: data.subarray(offset, offset + UPLOAD_CHUNK).toString("base64") })
        index += 1
      }
      await port.end(uploadId)
      uploads.push(uploadId)
    }
    this.transfer = true
    return { ...args, uploads }
  }
}

export function backend(input: { port?: BrowserHub.Port; directory: string }): ExtensionBackend {
  return new ExtensionBackend(input)
}
