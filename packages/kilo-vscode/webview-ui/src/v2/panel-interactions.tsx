// Small panel interactions the Agent Manager panel wires to its own state. They live here rather than in
// AgentManagerApp.tsx to keep that file under its size ratchet, which the repo lowered after earlier extractions.
import { buildShortcutCategories } from "../../agent-manager/shortcuts"
import { ShortcutsDialog } from "../../agent-manager/ShortcutsDialog"
import type { useDialog } from "@kilocode/kilo-ui/context/dialog"
import type { useLanguage } from "../context/language"

type Translate = ReturnType<typeof useLanguage>["t"]
type Bindings = Parameters<typeof buildShortcutCategories>[0]
type Dialog = ReturnType<typeof useDialog>

/** Opens the keyboard shortcuts dialog with the panel's current bindings. */
export function showShortcuts(dialog: Dialog, bindings: Bindings, t: Translate) {
  dialog.show(() => (
    <ShortcutsDialog title={t("agentManager.shortcuts.title")} categories={buildShortcutCategories(bindings, t)} />
  ))
}

/** Middle-click closes a tab, as an editor tab does. */
export function closeOnMiddleClick(event: MouseEvent, close: () => void) {
  if (event.button !== 1) return
  event.preventDefault()
  event.stopPropagation()
  close()
}
