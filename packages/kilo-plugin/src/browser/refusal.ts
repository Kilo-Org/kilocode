import { Permission } from "@opencode/core/permission"
import { Effect, Option, Schema } from "effect"
import { NeedsPermissionError, PageMovedError, type CallResult } from "./backend"
import { snapshot, split, Tracker, type Tab } from "./observation"
import { BrowserPermission } from "./permission"

/**
 * What the model is told when a browser step is refused: where the session's tab is, what a refused ask names, and how
 * many asks one call gets before it stops.
 */

/** The one tab bookkeeping every browser backend shares: which page each session's tab is on. */
export const tracker = new Tracker()

function textOf(result: CallResult) {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n")
}

const decodeOpened = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))

/**
 * The page a result shows: the browser's own report, the Playwright-style `Page URL` line, or the `{ title, url }`
 * answer the extension gives for a navigation.
 */
function pageUrl(result: CallResult) {
  const text = textOf(result)
  return (
    result.meta?.url ??
    snapshot(split(text))?.url ??
    Option.getOrUndefined(Option.map(decodeOpened(text), (opened) => opened.url))
  )
}

/**
 * Where a successful call left the session's tab: the page its result names; closed after `browser_close`; unknown
 * after a tab switch, open or close whose result names no page; unchanged (undefined) for any other call.
 */
export function placed(tool: string, args: Record<string, unknown>, result: CallResult): Tab | undefined {
  const url = pageUrl(result)
  if (url) return { kind: "page", url }
  if (tool === "browser_close") return { kind: "closed" }
  if (tool === "browser_tabs" && args.action !== "list") return { kind: "unknown" }
  return undefined
}

/**
 * Where a failed call left the session's tab: on the origin a redirect reached, unknown after a move to a page the
 * browser did not name, unchanged (undefined) for any other failure.
 */
export function movedTo(error: unknown): Tab | undefined {
  if (error instanceof PageMovedError) return { kind: "unknown" }
  if (error instanceof NeedsPermissionError && error.moved !== undefined) return { kind: "moved", origin: error.moved }
  return undefined
}

/**
 * Where the session's tab is, in the words a refusal uses: the page the last result showed, so the model's next step
 * starts from where the tab really is, not from the page it asked for.
 */
function tabLine(sessionID: string) {
  const tab = tracker.tab(sessionID)
  if (tab === undefined) return "This session has no browser tab yet."
  switch (tab.kind) {
    case "page":
      return `The tab is still on ${tab.url}.`
    case "moved":
      return `The tab is now on a page at ${tab.origin}.`
    case "closed":
      return "The session's browser tab is closed."
    case "unknown":
      return "Take a snapshot to see which page the tab is on."
  }
}

/** How many times one call asks before it stops: an act grant, a sensitive step and a redirect target. */
const ASK_LIMIT = 3

/** One need as the retry loop counts it: a sensitive step is told apart by its reason as well as its origin. */
export function need(item: BrowserPermission.Item) {
  const key = BrowserPermission.pattern(item)
  return item.class === "sensitive" ? `${key}:${item.reason ?? ""}` : key
}

function described(item: BrowserPermission.Item) {
  if (item.class === "sensitive") return `approval for a sensitive step on ${item.origin}`
  if (item.class === "read") return `permission to read ${item.origin}`
  if (item.class === "navigate") return `permission to open ${item.origin}`
  return `permission to act on ${item.origin}`
}

/**
 * Why a call that reported more needs stops asking, or undefined while it may ask again. Each distinct need gets one
 * ask; a need that comes back after it was approved, a refusal that names nothing, and a call past the ask limit stop,
 * and the text says which of these happened.
 */
export function exhausted(
  items: readonly BrowserPermission.Item[],
  asked: ReadonlySet<string>,
  asks: number,
): string | undefined {
  if (!items.length)
    return "The browser refused this step without naming the permission it needs. Continue without this action."
  const repeated = items.find((item) => asked.has(need(item)))
  if (repeated) {
    return `The browser asked again for ${described(repeated)} after it was approved. Do not repeat this step; continue without it or ask the user for help.`
  }
  if (asks >= ASK_LIMIT)
    return "This step needs more approvals than one call asks for. Call the tool again to ask for the rest."
  return undefined
}

/** What a refusal names: the class on its origin, or a sensitive step on its origin. */
export function subject(item: BrowserPermission.Item) {
  return `${item.class === "sensitive" ? "a sensitive step" : item.class} on ${item.origin}`
}

/** The model-facing text of each way a browser permission can be refused. */
const REFUSAL = {
  declined: (what: string, where: string) =>
    `The user denied ${what}. ${where} Do not retry; ask the user or continue without it.`,
  blocked: (what: string, where: string) =>
    `A permission rule denies ${what}. ${where} Do not retry; continue without it, or ask the user to change the rule.`,
  corrected: (what: string, where: string, feedback: string) =>
    `Permission for ${what} was not granted. ${where} ${feedback}`,
}

/**
 * A plain decline that names what was refused. It stays a `Permission.DeclinedError` defect, so the step still ends
 * the way any decline does; only the text a Code Mode program reads for it changes.
 */
class BrowserDeclinedError extends Permission.DeclinedError {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  override get message() {
    return this.text
  }
}

/**
 * One permission ask whose refusals name what was refused and the next step. A rule's deny and a decline with
 * feedback keep their own error types, so the host treats them as before; a plain decline stays a defect.
 */
export function ask(permission: Permission.Interface, request: Permission.AssertInput, what: string) {
  const where = () => tabLine(String(request.sessionID))
  return permission.assert(request).pipe(
    Effect.catchTags({
      "Permission.BlockedError": (error) =>
        Effect.fail(
          new Permission.BlockedError({
            rules: error.rules,
            permission: error.permission,
            resources: error.resources,
            reason: REFUSAL.blocked(what, where()),
          }),
        ),
      "Permission.CorrectedError": (error) =>
        Effect.fail(new Permission.CorrectedError({ feedback: REFUSAL.corrected(what, where(), error.feedback) })),
    }),
    Effect.catchDefect((defect) =>
      Effect.die(
        defect instanceof Permission.DeclinedError ? new BrowserDeclinedError(REFUSAL.declined(what, where())) : defect,
      ),
    ),
  )
}
