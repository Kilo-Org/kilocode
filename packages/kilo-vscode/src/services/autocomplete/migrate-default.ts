import * as vscode from "vscode"
import { DEFAULT_AUTOCOMPLETE_MODEL } from "../../shared/autocomplete-models"

const FLAG = "kilo.autocomplete.defaultClearMigrationV1"

/**
 * One-time migration: clear `kilo-code.new.autocomplete.{provider,model}` when
 * they exactly match the current `DEFAULT_AUTOCOMPLETE_MODEL`. Many users have
 * the default explicitly stored only because it was the only thing visible in
 * the dropdown — leaving it pinned would block them from picking up future
 * default changes (e.g. a switch to Mercury Next Edit) silently. After the
 * migration runs they show up as "Not set" and follow the resolved default.
 *
 * Users who picked a different model are untouched. The migration runs once
 * per machine and is gated on a globalState flag.
 *
 * TODO(2026-09): remove this migration. By September 2026 the cohort that
 * needed it will either have migrated already or be fine staying pinned.
 */
export async function migrateDefaultAutocompleteSettings(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(FLAG)) return

  const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
  // Read the user/global scope specifically. `get()` returns the merged
  // effective value (workspace > global > default), which would let a
  // workspace-level pin or the schema default falsely look like a stored
  // global default and cause us to no-op while still flipping the flag.
  const provider = config.inspect<string>("provider")?.globalValue
  const model = config.inspect<string>("model")?.globalValue

  const matchesDefault =
    provider === DEFAULT_AUTOCOMPLETE_MODEL.providerID && model === DEFAULT_AUTOCOMPLETE_MODEL.modelID

  if (matchesDefault) {
    await config.update("provider", undefined, vscode.ConfigurationTarget.Global)
    await config.update("model", undefined, vscode.ConfigurationTarget.Global)
  }

  await context.globalState.update(FLAG, true)
}
