// The v2 contract of the Create New Mode view. The name becomes the `agents.<name>` config key, so validation keeps
// it to a slug and rejects the names already listed.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Component, Show, createSignal } from "solid-js"
import { useLanguage } from "../../../context/language"
import { useSettingsConfig } from "../../../v2/settings-config"
import SettingsRow from "../SettingsRow"
import { agentField } from "./agents"

interface Props {
  /** Names already taken (used for uniqueness validation). */
  taken: string[]
  onBack: () => void
  onCreated: (id: string) => void
}

const ModeCreateView: Component<Props> = (props) => {
  const language = useLanguage()
  const config = useSettingsConfig()

  const [name, setName] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [system, setSystem] = createSignal("")
  const [error, setError] = createSignal("")

  const validate = (value: string): string => {
    if (!value.trim()) return language.t("settings.agentBehaviour.createMode.nameRequired")
    if (!/^[a-z][a-z0-9-]*$/.test(value.trim())) return language.t("settings.agentBehaviour.createMode.nameInvalid")
    if (props.taken.includes(value.trim())) return language.t("settings.agentBehaviour.createMode.nameTaken")
    return ""
  }

  const reset = () => {
    setName("")
    setDescription("")
    setSystem("")
    setError("")
  }

  const cancel = () => {
    reset()
    props.onBack()
  }

  const submit = () => {
    const slug = name().trim()
    const message = validate(slug)
    if (message) {
      setError(message)
      return
    }
    config.set(agentField(slug, "mode"), "primary")
    if (description().trim()) config.set(agentField(slug, "description"), description().trim())
    if (system().trim()) config.set(agentField(slug, "system"), system().trim())
    reset()
    props.onCreated(slug)
  }

  return (
    <div>
      <div style={{ display: "flex", "align-items": "center", "margin-bottom": "16px" }}>
        <IconButton size="small" variant="ghost" icon="arrow-left" onClick={cancel} />
        <span style={{ "font-weight": "600", "font-size": "var(--kilo-font-size-14)", "margin-left": "8px" }}>
          {language.t("settings.agentBehaviour.createMode")}
        </span>
      </div>

      <Card data-variant="wide-input" style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.agentBehaviour.createMode.name")}
          description={language.t("settings.agentBehaviour.createMode.name.description")}
          last
        >
          <TextField
            value={name()}
            placeholder={language.t("settings.agentBehaviour.createMode.name.placeholder")}
            onChange={(value) => {
              setName(value)
              setError("")
            }}
          />
          <Show when={error()}>
            <div
              style={{
                "font-size": "var(--kilo-font-size-11)",
                color: "var(--vscode-errorForeground)",
                "margin-top": "4px",
              }}
            >
              {error()}
            </div>
          </Show>
        </SettingsRow>
      </Card>

      <Card style={{ "margin-bottom": "12px" }}>
        <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
          {language.t("settings.agentBehaviour.createMode.description")}
        </div>
        <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
          {language.t("settings.agentBehaviour.createMode.description.help")}
        </div>
        <TextField
          value={description()}
          placeholder={language.t("settings.agentBehaviour.createMode.description.placeholder")}
          onChange={(value) => setDescription(value)}
        />
      </Card>

      <Card style={{ "margin-bottom": "12px" }}>
        <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
          {language.t("settings.agentBehaviour.createMode.prompt")}
        </div>
        <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
          {language.t("settings.agentBehaviour.createMode.prompt.help")}
        </div>
        <TextField
          value={system()}
          placeholder={language.t("settings.agentBehaviour.createMode.prompt.placeholder")}
          multiline
          onChange={(value) => setSystem(value)}
        />
      </Card>

      <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
        <Button variant="ghost" onClick={cancel}>
          {language.t("settings.agentBehaviour.createMode.cancel")}
        </Button>
        <Button variant="primary" onClick={submit}>
          {language.t("settings.agentBehaviour.createMode.button")}
        </Button>
      </div>
    </div>
  )
}

export default ModeCreateView
