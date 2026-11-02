import * as vscode from "vscode"
import type { Connection } from "./connection"
import { AUTOCOMPLETE_SECTION } from "./settings"

/** Start the Kilo server when autocomplete is on and a workspace folder is open. Starting is idempotent. */
export function ensureBackendForAutocomplete(connection: Pick<Connection, "start">): void {
  const enabled = vscode.workspace.getConfiguration(AUTOCOMPLETE_SECTION).get<boolean>("enableAutoTrigger") ?? true
  if (!enabled || !vscode.workspace.workspaceFolders?.[0]) return
  connection.start()
}
