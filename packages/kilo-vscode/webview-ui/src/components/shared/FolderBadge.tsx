/**
 * FolderBadge component
 * Names the workspace folder a session belongs to, shown only in multi-root workspaces.
 */

import { type Component, Show, createMemo } from "solid-js"
import { useServer } from "../../context/server"
import { folderOf } from "../../utils/workspace-folder"

export const FolderBadge: Component<{ directory?: string }> = (props) => {
  const server = useServer()
  const folder = createMemo(() =>
    server.workspaceFolders().length > 1 ? folderOf(props.directory, server.workspaceFolders()) : undefined,
  )

  return (
    <Show when={folder()}>
      {(item) => (
        <span class="workspace-folder-badge" title={props.directory}>
          {item().name}
        </span>
      )}
    </Show>
  )
}
