import type { LocationRef } from "@opencode/client"
import { startupMessage } from "../component/startup-loading"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useTuiStartup } from "../context/runtime"
import { usePlugin } from "../plugin/context"

export function usePendingSubmission(location: () => LocationRef) {
  const startup = useTuiStartup()
  const plugins = usePlugin()
  const local = useLocal()
  const data = useData()
  return () =>
    startup.workspaceReady &&
    (!startup.workspaceReady() ||
      !plugins.ready() ||
      !local.model.ready ||
      !local.model.catalogReady ||
      !submissionCatalogsLoaded(data, location()))
      ? startupMessage(plugins.ready())
      : undefined
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
