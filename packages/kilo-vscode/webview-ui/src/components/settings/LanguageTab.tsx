// Main's Language tab on the v2 `kilo-code.v2.language` setting. A pick applies at once through the host, which
// writes the setting and pushes it to every open view. `Auto` follows the VS Code display language.
import { Select } from "@kilocode/kilo-ui/select"
import { type Component } from "solid-js"
import { LOCALE_LABELS, LOCALES, useLanguage, type Locale } from "../../context/language"

const AUTO = "auto"
const options = [AUTO, ...LOCALES] as const
type Option = typeof AUTO | Locale

const LanguageTab: Component = () => {
  const language = useLanguage()
  const current = () => language.userOverride() || AUTO

  return (
    <div style={{ padding: "16px" }}>
      <p style={{ "font-size": "var(--kilo-font-size-13)", "margin-bottom": "12px" }}>
        {language.t("settings.language.description")}
      </p>
      <Select
        options={[...options]}
        current={current()}
        label={(opt: Option) => (opt === AUTO ? language.t("settings.language.auto") : LOCALE_LABELS[opt])}
        value={(opt: Option) => opt}
        onSelect={(opt) => {
          if (opt !== undefined) language.setLocale(opt === AUTO ? "" : (opt as Locale))
        }}
        variant="secondary"
        size="large"
      />
      <p
        style={{
          "font-size": "var(--kilo-font-size-12)",
          color: "var(--vscode-descriptionForeground)",
          "margin-top": "8px",
        }}
      >
        {language.t("settings.language.current")} {LOCALE_LABELS[language.locale()]}
      </p>
    </div>
  )
}

export default LanguageTab
