/**
 * Workspace folder choosers for multi-root workspaces.
 *
 * FolderMenu  — compact icon menu in the prompt bar: the root new sessions work in.
 * FolderSelect — labelled dropdown in the Settings header: the project a Settings panel edits.
 */

import { type Component, For, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useServer } from "../../context/server"

export const FolderMenu: Component<{ label: string }> = (props) => {
  const server = useServer()
  const current = createMemo(() => server.workspaceFolders().find((folder) => folder.path === server.selectedFolder()))
  const title = () => `${props.label}: ${current()?.name ?? ""}`

  return (
    <DropdownMenu gutter={4} placement="top-end">
      <Tooltip value={title()} placement="top" openDelay={0}>
        <DropdownMenu.Trigger as={IconButton} icon="folder" variant="ghost" size="small" aria-label={title()} />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="prompt-folder-menu">
          <DropdownMenu.RadioGroup
            value={server.selectedFolder()}
            onChange={(path) => typeof path === "string" && server.selectFolder(path)}
          >
            <For each={server.workspaceFolders()}>
              {(folder) => (
                <DropdownMenu.RadioItem value={folder.path} title={folder.path}>
                  <DropdownMenu.ItemLabel>{folder.name}</DropdownMenu.ItemLabel>
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check" size="small" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

export const FolderSelect: Component<{
  label: string
  placeholder?: string
  variant?: "ghost" | "secondary"
}> = (props) => {
  const server = useServer()

  return (
    <Select
      options={server.workspaceFolders()}
      current={server.workspaceFolders().find((folder) => folder.path === server.selectedFolder())}
      value={(folder) => folder.path}
      label={(folder) => folder.name}
      onSelect={(folder) => folder && server.selectFolder(folder.path)}
      variant={props.variant ?? "ghost"}
      size="small"
      placeholder={props.placeholder}
      aria-label={props.label}
    />
  )
}
