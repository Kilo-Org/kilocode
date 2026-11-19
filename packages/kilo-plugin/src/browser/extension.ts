import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  IncompatibleError,
  NeedsPermissionError,
  UNAVAILABLE_MESSAGE,
  UnavailableError,
  StoppedError,
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
 * What a call in a stopped conversation reports. The stop is sticky for that conversation: the model is told the user
 * stopped it, so it can ask for the browser to be turned back on or for a new session.
 */
export const STOPPED = "The user stopped this browser session."

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
function finishMeta(meta: BrowserHub.Meta, stepToken?: string, step?: BrowserHub.Step): CallResult["meta"] | undefined {
  const parsed = meta.needs === undefined ? undefined : needs(meta.needs)
  if (meta.needs !== undefined && parsed === undefined) return undefined
  return {
    ...(meta.url === undefined ? {} : { url: meta.url }),
    ...(meta.origin === undefined ? {} : { origin: meta.origin }),
    ...(meta.withheldFrames === undefined ? {} : { withheldFrames: meta.withheldFrames }),
    ...(parsed === undefined || parsed.length === 0 ? {} : { needs: parsed }),
    ...(stepToken === undefined ? {} : { stepToken }),
    ...(step === undefined ? {} : { step }),
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
  // A need carried by a result is after-action by contract: the call succeeded and then asked for a grant, so the
  // action already ran and the model reads the page instead of repeating the step.
  const flagged = meta?.needs === undefined ? meta : { ...meta, afterAction: true as const }
  return { content, isError: value.isError === true, ...(flagged ? { meta: flagged } : {}) }
}

/**
 * A failure that asks for more than one grant: the items the browser named, or a refusal when one of them cannot be
 * described (the caller then refuses rather than asking for half of it).
 */
function permissionError(error: BrowserHub.Failure): Error {
  const items = needs(error.items)
  if (items === undefined) return new Error(UNDESCRIBABLE)
  if (error.kind === "moved" && !items.length) {
    return new Error("The page changed before the step ran. Call the tool again.")
  }
  return new NeedsPermissionError(items, error.stepToken)
}

/** Every failure kind the transport reports, as the tool layer sees it. */
const MAPPED: Record<string, (error: BrowserHub.Failure) => Error> = {
  unavailable: (error) => new UnavailableError(HINT, UNAVAILABLE_MESSAGE, { effectsUncertain: error.uncertain }),
  permission: permissionError,
  moved: permissionError,
  busy: () => new Error("The tab is busy with another browser action. Try again in a moment."),
  taken: () => new Error("Another Kilo surface took over the tab. The action did not run; try again."),
  stopped: () => new StoppedError(STOPPED),
  unsupported: () => new UnsupportedError(),
  blocked: (error) => new Error(error.message || "The browser refused this page."),
  mismatch: () =>
    new IncompatibleError("The Kilo browser extension is out of date for this version of Kilo.", UPDATE_HINT),
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
  const mapped = MAPPED[error.kind]
  if (mapped) return mapped(error)
  return new Error(error.message || "The browser call failed.")
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
  /**
   * Tool sessions the browser ended. The stop is sticky for that conversation: re-opening a session silently would
   * undo the user's Stop all, so a call refuses instead. A new conversation starts with a fresh id and is unaffected;
   * there is no CLI-side resume inside the same conversation, so the refusal asks for the browser to be turned back on.
   */
  private readonly stopped = new Set<string>()
  /** Set by `dispose()`: an evicted backend must not open a session for a call that was already in flight. */
  private disposed = false

  constructor(private readonly input: { port?: BrowserHub.Port; directory: string }) {
    this.off =
      input.port?.onRevoked((event) => {
        const session = this.sessions.get(event.sessionHandle)
        if (session === undefined) return
        this.sessions.delete(event.sessionHandle)
        this.handles.delete(session)
        // Only the user's own decisions stop the conversation. A disconnect is the browser going away (a network drop,
        // an extension reload): the handle is dropped and the next call reopens when the extension is back.
        if (event.reason === "user_stop" || event.reason === "switch_off") this.stopped.add(session)
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

  /** The tool-session id, so a stop and a handle are always keyed the same way. */
  private session(ctx: CallContext) {
    return ctx.session ?? ""
  }

  /** A conversation the user stopped is refused before any open, so no session starts behind their back. */
  private refuse(session: string) {
    if (this.stopped.has(session)) throw new StoppedError(STOPPED)
  }

  /** An evicted backend refuses a call that was still in flight instead of opening a session nothing will close. */
  private live() {
    if (this.disposed) throw new Error("The browser backend was released; the call did not run.")
  }

  /** The tool names this extension serves, refusing a name it does not. */
  private async accepts(name: string) {
    const names = await this.names()
    if (names !== undefined && !names.has(name)) throw new UnsupportedError()
  }

  /**
   * The step token this call carries: the ones the caller approved, or the remembered one for exactly this repeat of
   * the step (a granted download).
   */
  private sensitive(ctx: CallContext, session: string, name: string, args: Record<string, unknown>) {
    if (ctx.sensitive !== undefined && ctx.sensitive.length) return [...ctx.sensitive]
    const step = takeStep(session, name, args)
    return step === undefined ? undefined : [step]
  }

  /** The call itself, with the arguments the extension needs and the grants this session approved. */
  private async send(
    port: BrowserHub.Port,
    input: {
      session: string
      handle: string
      name: string
      args: Record<string, unknown>
      /** The model's own arguments: a step token is remembered against those, whatever the extension is sent. */
      key: Record<string, unknown>
      ctx: CallContext
    },
  ) {
    const sensitive = this.sensitive(input.ctx, input.session, input.name, input.key)
    return port.call({
      sessionHandle: input.handle,
      name: input.name,
      arguments: input.args,
      authorized: grants(input.ctx.authorized ?? []),
      ...(sensitive === undefined ? {} : { sensitive }),
      ...(input.ctx.signal === undefined ? {} : { signal: input.ctx.signal }),
    })
  }

  /** The action already ran and only its content was withheld: ask for the grants and never repeat the step. */
  private withheld(error: BrowserHub.Failure): CallResult | undefined {
    if (!(error instanceof BrowserHub.Failure) || error.kind !== "permission" || !error.afterAction) return undefined
    const items = needs(error.items)
    if (items === undefined) return undefined
    const meta = finishMeta(
      { ...(error.meta ?? {}), ...(items.length ? { needs: items } : {}) },
      error.stepToken,
      error.step,
    )
    const flagged = meta === undefined ? undefined : { ...meta, afterAction: true as const }
    return {
      content: [
        { type: "text", text: error.message || "The action ran; its content is withheld until the user approves." },
      ],
      isError: false,
      ...(flagged ? { meta: flagged } : {}),
    }
  }

  async callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
    const port = this.input.port
    if (!port) throw new UnavailableError(HINT)
    const session = this.session(ctx)
    this.refuse(session)
    this.live()
    try {
      await this.accepts(name)
      const handle = await this.handle(port, session)
      const input = name === "browser_file_upload" ? await this.upload(port, args) : args
      return reply(await this.send(port, { session, handle, name, args: input, key: args, ctx }))
    } catch (error) {
      if (error instanceof BrowserHub.Failure) {
        const withheld = this.withheld(error)
        if (withheld !== undefined) return withheld
      }
      throw map(error)
    }
  }

  /** `/browser share`: the browser's active tab joins this conversation's group. The user's own command lifts a stop. */
  async share(session: string): Promise<void> {
    const port = this.available()
    try {
      await port.share(await this.handle(port, session))
    } catch (error) {
      throw map(error)
    }
    this.stopped.delete(session)
  }

  /** `/browser adopt`: the most recent ended group becomes this conversation's. The user's own command lifts a stop. */
  async adopt(session: string): Promise<BrowserHub.Adoption> {
    const port = this.available()
    try {
      const adopted = await port.adopt(await this.handle(port, session))
      this.stopped.delete(session)
      return adopted
    } catch (error) {
      throw map(error)
    }
  }

  private available(): BrowserHub.Port {
    this.live()
    if (!this.input.port) throw new UnavailableError(HINT)
    return this.input.port
  }

  /** Release the session's handle; a session the extension already dropped has nothing to close. */
  forget(session: string) {
    const handle = [...this.sessions].find(([, value]) => value === session)?.[0]
    const pending = this.handles.get(session)
    this.handles.delete(session)
    // A deleted conversation cannot be resumed, so its stop needs no remembering.
    this.stopped.delete(session)
    if (handle === undefined) return
    this.sessions.delete(handle)
    void pending?.then((value) => this.input.port?.close(value).catch(() => undefined))
  }

  /** The instance closes its browser sessions and releases the hub subscription; the connection belongs to the host. */
  async dispose() {
    this.disposed = true
    this.off()
    const handles = [...this.sessions.keys()]
    this.handles.clear()
    this.sessions.clear()
    this.stopped.clear()
    await Promise.all(handles.map((handle) => this.input.port?.close(handle).catch(() => undefined)))
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
    // Each attempt is its own promise: a later attempt for the same session supersedes an earlier one, and the earlier
    // one must not adopt its handle when it answers after the session was forgotten and reopened.
    const attempt = Promise.withResolvers<string>()
    this.handles.set(session, attempt.promise)
    void this.open(port, session, attempt.promise).then(attempt.resolve, attempt.reject)
    attempt.promise.catch(() => {
      if (this.handles.get(session) === attempt.promise) this.handles.delete(session)
    })
    return attempt.promise
  }

  private async open(port: BrowserHub.Port, session: string, attempt: Promise<string>): Promise<string> {
    await this.ready(port)
    // Anything awaited above may have outlived the backend: never open a session from a released instance.
    this.live()
    const opened = await port.open({
      sessionId: session || "unknown",
      title: session || "Kilo agent",
      cwd: this.input.directory,
    })
    // The session ended, or another attempt replaced this one, while the extension was still opening it: close the
    // late handle instead of keeping it (or claiming the new attempt's session) alive.
    if (this.handles.get(session) !== attempt) {
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
        throw new Error(`Cannot read ${file} for the upload: ${error instanceof Error ? error.message : String(error)}`)
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
