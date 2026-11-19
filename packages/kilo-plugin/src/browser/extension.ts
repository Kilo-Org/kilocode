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
import { contained, insideOutput, writeConfined } from "./playwright"
import { takeStep } from "./steps"

/** The protocol version this CLI speaks. An extension that does not list it cannot be driven safely. */
export const PROTOCOL = 1

/** The setup step the UI shows while no extension is reachable, and the action the model relays to the user. */
export const EXTENSION_HINT =
  'Install the Kilo browser extension and turn on "Allow local agents" in its settings, or set browser.backend to "playwright".'

const HINT = EXTENSION_HINT

/**
 * The setup step for why no extension answered, as the hub connection explains it: an installed extension whose switch
 * is off is told to turn it back on, never to install it. Without an explanation the general step stands.
 */
function extensionHint(absence: BrowserHub.Absence | undefined): string {
  if (absence === undefined) return EXTENSION_HINT
  switch (absence.kind) {
    case "connected":
      return 'The Kilo browser extension is connected but did not answer: try again, and reload the extension if it keeps failing, or set browser.backend to "playwright".'
    case "disconnected":
      return 'The Kilo browser extension is not connected: turn on "Allow local agents" in its settings and keep the browser open, then try again, or set browser.backend to "playwright".'
    case "unpaired":
      return 'No Kilo browser extension has connected yet: install it, or turn on "Allow local agents" in its settings if it is installed, then try again, or set browser.backend to "playwright".'
    case "no_profile":
      // The name comes from config a repository can set: quoted as a literal, it cannot reshape the sentence.
      return `No browser profile named ${JSON.stringify(absence.profile)} is connected: open it and turn on "Allow local agents" in its Kilo extension, or change browser.target.`
    case "no_hub":
      return 'Kilo could not start its connection to the browser: try again in a moment, or set browser.backend to "playwright".'
  }
}

/** The update notice for an extension this CLI cannot drive. */
export const UPDATE_HINT = "Update the Kilo browser extension to the current version, then retry."

/**
 * What a call on a tab with no web origin reports. `about:blank`, a browser page or a local file has no http(s) origin
 * (the browser spells it `://` or `opaque:null`), so no grant could ever cover it: the model is told to open a web page
 * instead of the user being asked to approve an empty origin.
 */
const NO_ORIGIN =
  "The tab has no web page open (about:blank, a browser page or a local file), so there is nothing to grant access to. Open an http(s) page with browser_navigate first."

/** What a frame without a web origin reports when nothing else on the page needs a grant. */
const FRAME_NO_ORIGIN =
  "A frame on this page has no web origin (a sandboxed or local frame), so it cannot be granted; continue without its content."

/**
 * The needs a person can be asked for, and the refusal when none is left. A class grant names an http(s) origin; a
 * sensitive step is approved by its token, whatever its origin. Only the needs without an origin are dropped, so an
 * opaque frame never hides the page's own grant, and only the tab itself having no origin means it has no web page.
 */
function grantable(items: readonly BrowserPermission.Item[]) {
  const blank = (item: BrowserPermission.Item) =>
    item.class !== "sensitive" && BrowserPermission.origin(item.origin) === undefined
  const askable = items.filter((item) => !blank(item))
  const dropped = items.filter(blank)
  if (askable.length || !dropped.length) return { items: askable }
  return { items: askable, refusal: dropped.some((item) => !item.frame) ? NO_ORIGIN : FRAME_NO_ORIGIN }
}

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
  // A need without a web origin cannot be granted: it is dropped, and when none is left the result says the action
  // ran and why nothing is asked. The rest of the meta (page, withheld frames) stays for the tool metadata.
  const asked = meta?.needs === undefined ? undefined : grantable(meta.needs)
  if (meta !== undefined && asked !== undefined && !asked.items.length) {
    const { needs: _unaskable, ...kept } = meta
    const note =
      asked.refusal === undefined ? [] : [{ type: "text" as const, text: `The action ran. ${asked.refusal}` }]
    return { content: [...content, ...note], isError: value.isError === true, meta: kept }
  }
  // A need carried by a result is after-action by contract: the call succeeded and then asked for a grant, so the
  // action already ran and the model reads the page instead of repeating the step.
  const flagged =
    meta === undefined || asked === undefined ? meta : { ...meta, needs: asked.items, afterAction: true as const }
  return { content, isError: value.isError === true, ...(flagged ? { meta: flagged } : {}) }
}

/**
 * A failure that asks for more than one grant: the items the browser named, or a refusal when one of them cannot be
 * described (the caller then refuses rather than asking for half of it).
 */
function permissionError(error: BrowserHub.Failure): Error {
  const described = needs(error.items)
  if (described === undefined) return new Error(UNDESCRIBABLE)
  const { items, refusal } = grantable(described)
  if (refusal !== undefined) return new Error(refusal)
  if (error.kind === "moved" && !items.length) {
    return new Error("The page changed before the step ran. Call the tool again.")
  }
  return new NeedsPermissionError(items, error.stepToken)
}

/** Every failure kind the transport reports, as the tool layer sees it. */
const MAPPED: Record<string, (error: BrowserHub.Failure) => Error> = {
  unavailable: (error) =>
    new UnavailableError(extensionHint(error.absence), UNAVAILABLE_MESSAGE, { effectsUncertain: error.uncertain }),
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

/**
 * Where `browser_take_screenshot`'s `filename` goes. The extension has no file system to write to, so the CLI writes
 * the image it returns, under the session's working directory with the Playwright backend's rules: a relative name
 * resolves inside the directory, and a name that escapes it is refused before the browser is asked.
 */
function screenshotFile(name: string, args: Record<string, unknown>, directory: string) {
  if (name !== "browser_take_screenshot") return undefined
  const filename = typeof args.filename === "string" ? args.filename.trim() : ""
  if (filename === "") return undefined
  const { filename: _written, ...rest } = args
  try {
    return { path: insideOutput(filename, directory), args: rest }
  } catch {
    throw new Error(`The screenshot file name must stay inside ${directory}.`)
  }
}

/** A screenshot name that leads outside the working directory. */
class OutsideError extends Error {}

/**
 * The file a screenshot is written to, checked again where it lands: the nearest existing ancestor is resolved, so a
 * symbolic link anywhere in the path that leads outside the working directory is refused, even for directories the
 * write would create below it.
 */
async function confined(file: string, directory: string): Promise<string> {
  const root = await fs.realpath(directory)
  const missing: string[] = []
  let existing = path.dirname(file)
  while ((await fs.lstat(existing).catch(() => undefined)) === undefined && path.dirname(existing) !== existing) {
    missing.unshift(path.basename(existing))
    existing = path.dirname(existing)
  }
  const target = path.join(await fs.realpath(existing), ...missing, path.basename(file))
  if (!contained(target, root)) throw new OutsideError(`The screenshot file name must stay inside ${directory}.`)
  return target
}

/** How many written screenshot files a backend remembers; an older one is treated as foreign, never overwritten. */
const WRITTEN_LIMIT = 200

/** Who opens a session: a turn's tool call, refused once the user stopped it, or the user's own share or adopt. */
type Opener = { kind: "turn"; turn: number | undefined } | { kind: "user" }

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
  private readonly stopped = new Map<string, number>()
  /** Numbers each stop, so a share or adopt lifts only the stop it saw, never one that arrived while it ran. */
  private stops = 0
  /** Screenshot files this backend wrote: a screenshot replaces one of these, never a file it did not write. */
  private readonly written = new Set<string>()
  /**
   * Every turn that was current when the user stopped this CLI's browser. Such a turn may not have opened a session
   * yet, so no revoke names it; it is refused all the same, until the conversation's next turn. Halts accumulate: an
   * open still in flight for an earlier stopped turn is judged by that turn after later stops. Turn numbers are unique
   * per process, so an old halt never matches a new turn, and the set grows only with the user's own stops.
   */
  private readonly halted = new Set<number>()
  /** Set by `dispose()`: an evicted backend must not open a session for a call that was already in flight. */
  private disposed = false

  constructor(
    private readonly input: {
      port?: BrowserHub.Port
      directory: string
      /** Each conversation's latest turn, numbered once per process: a new user message gets a new number. */
      turns?: ReadonlyMap<string, number>
    },
  ) {
    this.off =
      input.port?.onRevoked((event) => {
        for (const turn of input.turns?.values() ?? []) this.halted.add(turn)
        const session = this.sessions.get(event.sessionHandle)
        if (session === undefined) return
        this.sessions.delete(event.sessionHandle)
        this.handles.delete(session)
        // Every revoke is the user's decision: Stop all, the switch, or Disconnect on this CLI. A dropped connection
        // sends none; its calls fail as unavailable and the next call reopens once the extension is back.
        this.stopped.set(session, ++this.stops)
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

  /**
   * A conversation the user stopped is refused before any open, so no session starts behind their back. `turn` is the
   * turn the decision belongs to: an open that was in flight is judged by the turn that started it, which may have
   * ended (and left `turns`) by the time the open answers.
   */
  private halts(session: string, turn: number | undefined) {
    return this.stopped.has(session) || (turn !== undefined && this.halted.has(turn))
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
    const file = screenshotFile(input.name, input.args, this.input.directory)
    const answer = await port.call({
      sessionHandle: input.handle,
      name: input.name,
      arguments: file ? file.args : input.args,
      authorized: grants(input.ctx.authorized ?? []),
      ...(sensitive === undefined ? {} : { sensitive }),
      ...(input.ctx.signal === undefined ? {} : { signal: input.ctx.signal }),
    })
    return file ? this.save(file.path, answer) : answer
  }

  /**
   * Write a screenshot's image to its file and link it, as the Playwright backend answers. The call already ran, so a
   * file that cannot be written is a note in the result, never a failed call.
   */
  private async save(file: string, answer: BrowserHub.Reply): Promise<BrowserHub.Reply> {
    const image = answer.content.find(
      (block): block is Extract<BrowserHub.Block, { type: "image" }> => block.type === "image",
    )
    if (answer.isError || image === undefined) return answer
    // A folder that cannot be resolved (a broken link, a missing working directory) is a file that could not be saved,
    // said in words; the system's error code tells the model nothing it can act on.
    const checked = await confined(file, this.input.directory).then(
      (target) => ({ kind: "inside" as const, target }),
      (error: unknown) => ({
        kind: "refused" as const,
        text:
          error instanceof OutsideError
            ? error.message
            : `The screenshot could not be saved to ${file}: a folder in that path cannot be opened. Pass another filename to save it.`,
      }),
    )
    if (checked.kind === "refused") {
      return { ...answer, content: [...answer.content, { type: "text", text: checked.text }] }
    }
    const target = checked.target
    const foreign = !this.written.has(target) && (await fs.lstat(target).catch(() => undefined)) !== undefined
    const note = foreign
      ? `${target} already exists, so the screenshot was not saved over it. Pass another filename to save it.`
      : await writeConfined(target, Buffer.from(image.data, "base64")).then(
          () => {
            this.written.delete(target)
            this.written.add(target)
            if (this.written.size > WRITTEN_LIMIT) this.written.delete(this.written.values().next().value ?? target)
            return `- [Screenshot](${target})`
          },
          (error: unknown) =>
            `The screenshot could not be saved to ${target}: ${error instanceof Error ? error.message : String(error)}`,
        )
    return { ...answer, content: [...answer.content, { type: "text", text: note }] }
  }

  /** The action already ran and only its content was withheld: ask for the grants and never repeat the step. */
  private withheld(error: BrowserHub.Failure): CallResult | undefined {
    if (!(error instanceof BrowserHub.Failure) || error.kind !== "permission" || !error.afterAction) return undefined
    const described = needs(error.items)
    if (described === undefined) return undefined
    const { items, refusal } = grantable(described)
    const meta = finishMeta(
      { ...(error.meta ?? {}), ...(items.length ? { needs: items } : {}) },
      error.stepToken,
      error.step,
    )
    if (refusal !== undefined) {
      // Nothing to ask: the action ran, and the page and frame data still reach the tool metadata. A needs list the
      // browser also sent in the meta names the same unaskable grants, so it is dropped too.
      const { needs: _unaskable, ...kept } = meta ?? {}
      return {
        content: [{ type: "text", text: `The action ran. ${refusal}` }],
        isError: false,
        ...(meta === undefined ? {} : { meta: kept }),
      }
    }
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
    const turn = this.input.turns?.get(session)
    if (this.halts(session, turn)) throw new StoppedError(STOPPED)
    this.live()
    try {
      await this.accepts(name)
      const handle = await this.handle(port, session, { kind: "turn", turn })
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
    const stop = this.stopped.get(session)
    try {
      await port.share(await this.handle(port, session, { kind: "user" }))
    } catch (error) {
      throw map(error)
    }
    this.resume(session, stop)
  }

  /** `/browser adopt`: the most recent ended group becomes this conversation's. The user's own command lifts a stop. */
  async adopt(session: string): Promise<BrowserHub.Adoption> {
    const port = this.available()
    const stop = this.stopped.get(session)
    try {
      const adopted = await port.adopt(await this.handle(port, session, { kind: "user" }))
      this.resume(session, stop)
      return adopted
    } catch (error) {
      throw map(error)
    }
  }

  /**
   * Lift the stop `stop` that a share or adopt saw when it started, and the halt of the conversation's current turn. A
   * stop the user made while the command ran is newer than the command, so it stays and the command reports the
   * session stopped.
   */
  private resume(session: string, stop: number | undefined) {
    const current = this.stopped.get(session)
    if (current !== undefined && current !== stop) throw new StoppedError(STOPPED)
    this.stopped.delete(session)
    const turn = this.input.turns?.get(session)
    if (turn !== undefined) this.halted.delete(turn)
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

  /**
   * One session handle per tool session, opened once and shared by concurrent calls. A turn's open is refused once the
   * user stopped that turn or conversation; the user's own `/browser share` or `/browser adopt` opens all the same.
   */
  private handle(port: BrowserHub.Port, session: string, opener: Opener): Promise<string> {
    const existing = this.handles.get(session)
    if (existing) return existing
    // Each attempt is its own promise: a later attempt for the same session supersedes an earlier one, and the earlier
    // one must not adopt its handle when it answers after the session was forgotten and reopened.
    const attempt = Promise.withResolvers<string>()
    this.handles.set(session, attempt.promise)
    // The turn that starts the open owns it: a stop of that turn still applies when the open answers after it ended.
    void this.open(port, session, attempt.promise, opener).then(attempt.resolve, attempt.reject)
    attempt.promise.catch(() => {
      if (this.handles.get(session) === attempt.promise) this.handles.delete(session)
    })
    return attempt.promise
  }

  private async open(
    port: BrowserHub.Port,
    session: string,
    attempt: Promise<string>,
    opener: Opener,
  ): Promise<string> {
    await this.ready(port)
    // Anything awaited above may have outlived the backend: never open a session from a released instance.
    this.live()
    const opened = await port.open({
      sessionId: session || "unknown",
      title: session || "Kilo agent",
      cwd: this.input.directory,
    })
    // The session ended, another attempt replaced this one, or the user stopped the turn while the extension was still
    // opening it: close the late handle instead of keeping it (or claiming the new attempt's session) alive.
    const refused =
      this.handles.get(session) !== attempt
        ? new Error("The session ended before its browser session opened.")
        : opener.kind === "turn" && this.halts(session, opener.turn)
          ? new StoppedError(STOPPED)
          : undefined
    if (refused) {
      await port.close(opened.sessionHandle).catch(() => undefined)
      throw refused
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

export function backend(input: ConstructorParameters<typeof ExtensionBackend>[0]): ExtensionBackend {
  return new ExtensionBackend(input)
}
