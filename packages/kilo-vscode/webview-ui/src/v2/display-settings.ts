// The effective display layouts, pushed by the host. The three keys are Kilo-only config fields, so the config API
// cannot carry them; the chat asks the host on connect and after every config change.
import { createSignal, onCleanup } from "solid-js"
import { resetToolOpenState } from "@kilocode/kilo-ui/tool-open-state"
import { DISPLAY_DEFAULTS, type DisplaySettings, type ToHost, type ToWebview } from "../../../src/protocol"
import { useVSCode } from "../context/vscode"
import { layoutChanged } from "./display-layout"

const [displaySettings, setDisplaySettings] = createSignal<DisplaySettings>(DISPLAY_DEFAULTS)

export { displaySettings }

export function useDisplaySettings() {
  const vscode = useVSCode()
  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as ToWebview
    if (message.type === "displaySettingsLoaded") {
      // A remembered open state is a user choice for one call under the old layout. Once a layout changes, the new
      // default has to win on the next mount, or a reopened session ignores the setting.
      if (layoutChanged(displaySettings(), message.values)) resetToolOpenState()
      setDisplaySettings(message.values)
    }
  })
  onCleanup(unsubscribe)
  return {
    values: displaySettings,
    request: () => vscode.postMessage({ type: "requestDisplaySettings" } satisfies ToHost as never),
  }
}
