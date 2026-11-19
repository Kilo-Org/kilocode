// `/browser share` and `/browser adopt`, and the notices a failed browser call raises for the user. Both commands act
// on the current session's browser tabs through the `kilocode.browser` RPC of the session's own location: that
// location's browser plugin holds the session's tab group, so another location's answer would be another group.
import type { Plugin } from "@opencode/plugin/tui"
import { KiloBrowserRpc } from "@opencode/schema/kilocode/browser"
import { errorMessage } from "../util/error"
import { browserCopy } from "./browser-copy"

type Toast = Parameters<Plugin.Context["ui"]["toast"]["show"]>[0]

type Failure = Extract<
  KiloBrowserRpc.Share | KiloBrowserRpc.Adopt,
  { kind: "unavailable" | "refused" | "not_extension" }
>

const ADOPTED = {
  adopted: { variant: "success", message: "browser.adopt.done" },
  none: { variant: "info", message: "browser.adopt.none" },
  kept: { variant: "info", message: "browser.adopt.kept" },
  unconfirmed: { variant: "info", message: "browser.adopt.unconfirmed" },
} as const

/** The toast for an answer that did not share or adopt: the setup step, the browser's reason, or the backend to pick. */
function failed(result: Failure): Toast {
  if (result.kind === "unavailable")
    return {
      variant: "warning",
      title: browserCopy("browser.notice.unavailableTitle"),
      message: result.hint,
      duration: 10000,
    }
  if (result.kind === "refused") return { variant: "error", message: result.message, duration: 10000 }
  return { variant: "warning", message: browserCopy("browser.control.notExtension"), duration: 10000 }
}

/** The toast one `/browser share` answer shows. */
export function shareToast(result: KiloBrowserRpc.Share): Toast {
  if (result.kind === "shared") return { variant: "success", message: browserCopy("browser.share.done") }
  return failed(result)
}

/** The toast one `/browser adopt` answer shows. */
export function adoptToast(result: KiloBrowserRpc.Adopt): Toast {
  if (result.kind === "unavailable" || result.kind === "refused" || result.kind === "not_extension")
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
    share: () => act((sessionID, options) => rpc.share({ sessionID }, options).then(shareToast)),
    adopt: () => act((sessionID, options) => rpc.adopt({ sessionID }, options).then(adoptToast)),
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
