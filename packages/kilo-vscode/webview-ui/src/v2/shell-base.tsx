// The providers every Kilo webview mounts: theme, dialogs, the VS Code API, language, the model picker preferences
// and toasts. The chat adds the rich-content providers; the Settings and Profile panels do not load them.
// The host pushes `kilo-code.v2.*` changes here, so the language and the font size follow without a reload.
import { onCleanup, type ParentComponent } from "solid-js"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { LanguageProvider } from "../context/language"
import { ModelPreferencesProvider } from "../context/model-preferences"
import { useVSCode, VSCodeProvider } from "../context/vscode"
import { applyKiloSettings, kiloSettings } from "./kilo-settings"

export const ShellBase: ParentComponent = (props) => (
  <ThemeProvider defaultTheme="kilo-vscode">
    <DialogProvider>
      <VSCodeProvider>
        <LiveSettings>
          <ModelPreferencesProvider>{props.children}</ModelPreferencesProvider>
        </LiveSettings>
      </VSCodeProvider>
      <Toast.Region />
    </DialogProvider>
  </ThemeProvider>
)

const LiveSettings: ParentComponent = (props) => {
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
      {props.children}
    </LanguageProvider>
  )
}
