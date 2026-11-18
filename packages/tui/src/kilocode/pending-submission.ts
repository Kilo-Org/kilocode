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
      data.location.command.list(location()) === undefined ||
      data.session.form.list("global", location()) === undefined)
      ? startupMessage(plugins.ready())
      : undefined
}
