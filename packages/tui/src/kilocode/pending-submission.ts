import type { LocationRef } from "@opencode/client"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { startupMessage } from "../component/startup-loading"
import { locationKey, useData } from "../context/data"
import { useLocation } from "../context/location"
import { useLocal } from "../context/local"
import { useTuiStartup } from "../context/runtime"
import { usePlugin } from "../plugin/context"
import { useToast } from "../ui/toast"

export function usePendingSubmission(location: () => LocationRef) {
  const startup = useTuiStartup()
  const plugins = usePlugin()
  const local = useLocal()
  const data = useData()
  const current = useLocation()
  const toast = useToast()
  const workspace = startup.workspaceReady
  if (!workspace) return () => undefined
  const target = () => current.ref ?? location()
  const catalogs = () =>
    workspace() &&
    plugins.ready() &&
    local.model.ready &&
    local.model.catalogReady &&
    submissionCatalogsLoaded(data, target())
  const waiting = initialCatalogWait(
    catalogs,
    () => {
      const failure = current.syncFailure
      return failure && locationKey(failure.location) === locationKey(target()) ? failure : undefined
    },
    (cause) => toast.error(cause),
  )
  return () => (!workspace() || waiting() ? startupMessage(plugins.ready()) : undefined)
}

// This is an initial editing affordance, not a second set of submission rules. After startup (or a
// failed/stalled catalog load), let the ordinary model, command and form handlers own submission again.
export function initialCatalogWait(
  loaded: () => boolean,
  failure: () => { cause: unknown } | undefined,
  report: (cause: unknown) => void,
  deadline = AbortSignal.timeout(30_000),
) {
  const [waiting, setWaiting] = createSignal(true)
  createEffect(() => {
    if (!waiting()) return
    if (loaded()) return setWaiting(false)
    const settled = failure()
    if (settled) {
      setWaiting(false)
      report(settled.cause)
      return
    }
    const expire = () => {
      setWaiting(false)
      report(deadline.reason)
    }
    if (deadline.aborted) return expire()
    deadline.addEventListener("abort", expire, { once: true })
    onCleanup(() => deadline.removeEventListener("abort", expire))
  })
  return waiting
}

type Data = ReturnType<typeof useData>

export function submissionCatalogsLoaded(
  data: { location: Pick<Data["location"], "agent" | "command">; session: Pick<Data["session"], "form"> },
  location: LocationRef,
) {
  return (
    data.location.agent.list(location) !== undefined &&
    data.location.command.list(location) !== undefined &&
    data.session.form.list("global", location) !== undefined
  )
}
