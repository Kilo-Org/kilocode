// `/browser share` and `/browser adopt`, and the notices a failed browser call raises for the user. Both commands act
// on the current session's browser tabs through the `kilocode.browser` RPC of the session's own location: that
// location's browser plugin holds the session's tab group, so another location's answer would be another group.
import type { Plugin } from "@opencode/plugin/tui"
import { KiloBrowserRpc } from "@opencode/schema/kilocode/browser"
import { isRecord } from "../util/record"
import { errorMessage } from "../util/error"
import { browserCopy } from "./browser-copy"

type Toast = Parameters<Plugin.Context["ui"]["toast"]["show"]>[0]

type Failure = Extract<
  KiloBrowserRpc.Share | KiloBrowserRpc.Adopt,
  { kind: "unavailable" | "refused" | "not_extension" | "organization_off" }
>

const ADOPTED = {
  adopted: { variant: "success", message: "browser.adopt.done" },
  none: { variant: "info", message: "browser.adopt.none" },
  kept: { variant: "info", message: "browser.adopt.kept" },
  unconfirmed: { variant: "info", message: "browser.adopt.unconfirmed" },
} as const

/**
 * The toast for an answer that did not share or adopt: the setup step, the browser's reason, the organization's block,
 * or the backend to pick.
 */
function failed(result: Failure): Toast {
  if (result.kind === "unavailable")
    return {
      variant: "warning",
      title: browserCopy("browser.notice.unavailableTitle"),
      message: result.hint,
      duration: 10000,
    }
  if (result.kind === "refused") return { variant: "error", message: result.message, duration: 10000 }
  if (result.kind === "organization_off")
    return { variant: "warning", message: browserCopy("browser.control.organizationOff"), duration: 10000 }
  return { variant: "warning", message: browserCopy("browser.control.notExtension"), duration: 10000 }
}

/** The toast one `/browser share` answer shows. */
export function shareToast(result: KiloBrowserRpc.Share): Toast {
  if (result.kind === "shared") return { variant: "success", message: browserCopy("browser.share.done") }
  return failed(result)
}

/** The toast one `/browser adopt` answer shows. */
export function adoptToast(result: KiloBrowserRpc.Adopt): Toast {
  if (
    result.kind === "unavailable" ||
    result.kind === "refused" ||
    result.kind === "not_extension" ||
    result.kind === "organization_off"
  )
    return failed(result)
  const toast = ADOPTED[result.kind]
  return { variant: toast.variant, message: browserCopy(toast.message) }
}

/** The toast one failed browser call raises; a session that is not open gets the offer to open it. */
export function noticeToast(notice: KiloBrowserRpc.Notice): Toast {
  const base = { sessionID: notice.sessionID, duration: 10000 }
  if (notice.kind === "stopped") return { ...base, variant: "info", message: browserCopy("browser.notice.stopped") }
  const title = notice.kind === "unavailable" ? "browser.notice.unavailableTitle" : "browser.notice.outdatedTitle"
  return { ...base, variant: "warning", title: browserCopy(title), message: notice.hint }
}

// How long a command typed while Kilo starts waits for the location's plugins, and how often it asks: at once, then
// after a gap that doubles from 100 ms up to 1 s, so a slow start is not asked ten times a second.
const STARTUP_WAIT = 10_000
const STARTUP_POLL = 100
const STARTUP_POLL_MAX = 1_000

/** The time source the wait reads; the default is the real clock. */
type Clock = { now(): number; sleep(ms: number): Promise<unknown> }

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) }

/**
 * One `/browser share` or `/browser adopt` call. A location answers `rpc.unavailable` until its plugins are
 * registered, and lists no plugin until then, so the command first waits until the location lists its plugins and then
 * calls once. It never calls again: `rpc.unavailable` also answers a call whose location shut down while the browser
 * was acting, and a second share or adopt would move another tab or group. That answer, like a location that still
 * lists no plugin when the wait ends, says Kilo is starting; every other failure rejects unchanged.
 */
export async function whenStarted(
  call: () => Promise<Toast>,
  plugins: () => Promise<{ data: readonly unknown[] }>,
  clock: Clock = realClock,
): Promise<Toast> {
  const deadline = clock.now() + STARTUP_WAIT
  let gap = STARTUP_POLL
  while (clock.now() < deadline) {
    // A server without the plugin inventory fails the read, which ends the wait at once.
    const listed = await plugins().then(
      (result) => result.data.length > 0,
      () => true,
    )
    if (listed) break
    await clock.sleep(Math.min(gap, deadline - clock.now()))
    gap = Math.min(gap * 2, STARTUP_POLL_MAX)
  }
  try {
    return await call()
  } catch (error) {
    if (!isRecord(error) || error.type !== "rpc.unavailable") throw error
    return { variant: "warning", message: browserCopy("browser.command.starting") }
  }
}

export function browserSession(context: Plugin.Context) {
  const rpc = context.client.rpc(KiloBrowserRpc.Definition)
  // One notice per session and kind: a model that retries must not stack the same toast. A share or adopt that
  // succeeds is the user acting on it, so that session's next notice shows again.
  const shown = new Set<string>()
  const forget = (sessionID: string) => {
    for (const key of [...shown]) if (key.startsWith(`${sessionID}:`)) shown.delete(key)
  }

  // The routed session, or a new one in the current location: a share before the first prompt is for that session.
  const session = async () => {
    const route = context.ui.router.current()
    if (route.type === "session") {
      const directory = context.data.session.get(route.sessionID)?.location.directory
      return { sessionID: route.sessionID, options: directory ? { location: { directory } } : undefined }
    }
    const location = context.location ?? context.data.location.default()
    const created = await context.client.session.create({ location: { directory: location.directory } })
    context.ui.router.navigate({ type: "session", sessionID: created.id })
    return { sessionID: created.id, options: { location: { directory: created.location.directory } } }
  }

  const act = async (
    run: (sessionID: string, options: { location: { directory: string } } | undefined) => Promise<Toast>,
  ) => {
    try {
      const current = await session()
      const toast = await run(current.sessionID, current.options)
      if (toast.variant === "success" || toast.variant === "info") forget(current.sessionID)
      context.ui.toast.show(toast)
    } catch (error) {
      context.ui.toast.show({
        variant: "error",
        title: browserCopy("browser.command.title"),
        message: errorMessage(error),
      })
    }
  }

  return {
    share: () =>
      act((sessionID, options) =>
        whenStarted(
          () => rpc.share({ sessionID }, options).then(shareToast),
          () => context.client.plugin.list(options),
        ),
      ),
    adopt: () =>
      act((sessionID, options) =>
        whenStarted(
          () => rpc.adopt({ sessionID }, options).then(adoptToast),
          () => context.client.plugin.list(options),
        ),
      ),
    /** Shows each failed call's notice once per session and kind; returns the unsubscribe. */
    watch: () =>
      rpc.events.on("notice", (event) => {
        const key = `${event.data.sessionID}:${event.data.kind}`
        if (shown.has(key)) return
        shown.add(key)
        context.ui.toast.show(noticeToast(event.data))
      }),
  }
}
