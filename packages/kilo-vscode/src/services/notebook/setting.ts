import { workspace } from "vscode"

/**
 * The notebook tools are opt-in. An absent or false setting keeps the broker endpoint out of the server
 * environment, so the tools are not registered. Only a trusted workspace may offer the capability.
 */
export function notebookToolsEnabled(): boolean {
  return (
    workspace.isTrusted &&
    workspace.getConfiguration("kilo-code.v2").get<boolean>("experimental.nativeNotebookTools") === true
  )
}
