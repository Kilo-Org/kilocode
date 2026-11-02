// The effective display layouts, pushed by the host. The three keys are Kilo-only config fields, so the config API
// cannot carry them; the chat asks the host on connect and after every config change.
import { createSignal, onCleanup } from "solid-js"
import { DISPLAY_DEFAULTS, type DisplaySettings, type ToHost, type ToWebview } from "../../../src/protocol"
import { useVSCode } from "../context/vscode"

const [displaySettings, setDisplaySettings] = createSignal<DisplaySettings>(DISPLAY_DEFAULTS)

export { displaySettings }

export function useDisplaySettings() {
  const vscode = useVSCode()
  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as ToWebview
    if (message.type === "displaySettingsLoaded") setDisplaySettings(message.values)
  })
  onCleanup(unsubscribe)
  return {
    values: displaySettings,
    request: () => vscode.postMessage({ type: "requestDisplaySettings" } satisfies ToHost as never),
  }
}
