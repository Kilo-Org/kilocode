/**
 * FolderSelect component
 * Chooses which workspace folder a new session starts in, for multi-root workspaces.
 */

import { type Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"

export const FolderSelect: Component = () => {
  const server = useServer()
  const language = useLanguage()

  return (
    <Select
      options={server.workspaceFolders()}
      current={server.workspaceFolders().find((folder) => folder.path === server.selectedFolder())}
      value={(folder) => folder.path}
      label={(folder) => folder.name}
      onSelect={(folder) => folder && server.selectFolder(folder.path)}
      variant="ghost"
      size="small"
      aria-label={language.t("prompt.folder.label")}
    />
  )
}
