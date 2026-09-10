import { type ParentComponent } from "solid-js"
import { LanguageProvider } from "./language"
import { useServer } from "./server"

export const LanguageBridge: ParentComponent = (props) => {
  const server = useServer()
  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      {props.children}
    </LanguageProvider>
  )
}
