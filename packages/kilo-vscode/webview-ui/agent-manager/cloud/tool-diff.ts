import { createSignal } from "solid-js"
import type { ToolActionDiff } from "../../../src/protocol"
import { groupEditFiles, type DiffStyle, type EditPreview } from "../edit-preview"
import type { ChatRoute } from "./route"

export type CloudDiffActions = {
  openDiff: (file: ToolActionDiff) => void
  openDiffs: (files: ToolActionDiff[]) => void
}
export type DiffPreferences = {
  style: () => DiffStyle
  markdown: () => boolean
  updateStyle: (style: DiffStyle) => void
  updateMarkdown: (render: boolean) => void
}

/** Tool paths are display labels. A preview is bound to the same authorized transcript as its buttons. */
export function createCloudToolPreview(
  active: (route: ChatRoute) => boolean,
  prefs: DiffPreferences,
  show: () => void,
  hide: () => void,
) {
  const [entry, setEntry] = createSignal<{ route: ChatRoute; diff: EditPreview["diff"] }>()
  function actions(route: ChatRoute): CloudDiffActions {
    const open = (files: ToolActionDiff[]) => {
      if (
        !active(route) ||
        files.some((file) => !file.file || !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(file.patch))
      )
        return
      const diff = groupEditFiles(files)
      if (!diff) return
      setEntry({ route, diff })
      show()
    }
    return { openDiff: (file) => open([file]), openDiffs: open }
  }
  return {
    actions,
    preview(): EditPreview | undefined {
      const value = entry()
      if (value && active(value.route)) return { diff: value.diff, style: prefs.style(), markdown: prefs.markdown() }
    },
    clear: () => setEntry(undefined),
    close: () => {
      setEntry(undefined)
      hide()
    },
    updateStyle: prefs.updateStyle,
    updateMarkdown: prefs.updateMarkdown,
  }
}
export type CloudToolPreview = ReturnType<typeof createCloudToolPreview>
