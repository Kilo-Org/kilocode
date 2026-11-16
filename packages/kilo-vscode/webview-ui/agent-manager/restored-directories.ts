// A worktree folder deleted on disk has no server Location, so every load of its store failed. Restoring the folder from
// its branch makes it loadable again, and the store would otherwise keep the failure and its empty catalogs until the
// panel reopens. The host clears the health entry of a restored folder, so a directory leaving the missing set is one
// that exists again.
import { createEffect, on } from "solid-js"
import type { AppDirectories } from "./app-directories"
import type { PanelData } from "./v2/panel-data"

export function reloadRestoredDirectories(panel: PanelData, directories: AppDirectories): void {
  createEffect(
    on(directories.missingDirectories, (missing, previous) => {
      const known = new Set(directories.sessionDirectories())
      previous?.filter((dir) => known.has(dir) && !missing.includes(dir)).forEach(panel.reload)
    }),
  )
}
