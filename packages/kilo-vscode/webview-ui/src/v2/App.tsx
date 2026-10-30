// The v2 sidebar and the Settings panel: main's providers for theme, dialogs, language and rich content, with the v2
// data layer. The host pushes `kilo-code.v2.*` changes here, so the language and the font size follow without a reload.
import { onCleanup, Show, type ParentComponent } from "solid-js"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { LanguageProvider } from "../context/language"
import { RichProvider } from "../context/rich-provider"
import { useVSCode, VSCodeProvider } from "../context/vscode"
import { Chat } from "./chat"
import { V2Provider } from "./client"
import { applyKiloSettings, kiloSettings } from "./kilo-settings"
import { SettingsView } from "./settings"
import "../styles/chat.css"

export default function App(props: { directory: string; view: string }) {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <LiveSettings directory={props.directory} view={props.view} />
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}

/** The language and font size follow the pushed `kilo-code.v2.*` settings. */
const LiveSettings: ParentComponent<{ directory: string; view: string }> = (props) => {
  const vscode = useVSCode()
  // The VS Code language is fixed at load; the resolved locale later rewrites `document.documentElement.lang`.
  const vscodeLanguage = document.documentElement.lang
  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as unknown as { type?: string; values?: Record<string, unknown> }
    if (message.type === "vscodeSettingsLoaded" && message.values) applyKiloSettings(message.values)
  })
  onCleanup(unsubscribe)
  return (
    <LanguageProvider
      vscodeLanguage={() => vscodeLanguage}
      languageOverride={() => kiloSettings().language as string | undefined}
    >
      <RichProvider>
        <V2Provider directory={props.directory}>
          <div class="container">
            <Show when={props.view === "settings"} fallback={<Chat />}>
              <SettingsView />
            </Show>
          </div>
        </V2Provider>
      </RichProvider>
    </LanguageProvider>
  )
}
