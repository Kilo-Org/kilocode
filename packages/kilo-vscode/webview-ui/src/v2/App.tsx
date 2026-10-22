// The v2 sidebar: main's providers for theme, dialogs, language and rich content, with the v2 data layer.
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { LanguageProvider } from "../context/language"
import { RichProvider } from "../context/rich-provider"
import { VSCodeProvider } from "../context/vscode"
import { Chat } from "./chat"
import { V2Provider } from "./client"
import "../styles/chat.css"

export default function App(props: { directory: string }) {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <LanguageProvider vscodeLanguage={() => document.documentElement.lang}>
            <RichProvider>
              <V2Provider directory={props.directory}>
                <div class="container">
                  <Chat />
                </div>
              </V2Provider>
            </RichProvider>
          </LanguageProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
