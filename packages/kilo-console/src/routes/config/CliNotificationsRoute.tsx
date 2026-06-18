import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { CustomSelect, type SelectOption } from "../../components/CustomSelect"
import { ConfigPage, ConfigTag as Tag } from "./ConfigPage"
import { type TitleIcon, useTuiNotificationSettings } from "./state/ui"

const icons = [
  { value: "none", label: "None" },
  { value: "unicode", label: "Unicode" },
  { value: "emojis", label: "Emojis" },
] satisfies SelectOption<TitleIcon>[]

function Toggle(props: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      class="ui-toggle"
      classList={{ selected: props.checked }}
      type="button"
      aria-pressed={props.checked}
      disabled={props.disabled}
      onClick={props.onChange}
    >
      <span>
        <strong>{props.label}</strong>
        <small>{props.description}</small>
      </span>
      <Tag tone={props.checked ? "success" : "neutral"}>{props.checked ? "On" : "Off"}</Tag>
    </button>
  )
}

export function CliNotificationsRoute() {
  const state = useTuiNotificationSettings()

  return (
    <ConfigPage
      title="CLI Notifications"
      description="Configure terminal title indicators, TUI attention alerts, desktop notifications, and sound defaults."
      actions={
        <Button variant="primary" disabled={Boolean(state.ctx.saving()) || !state.dirty()} onClick={state.save}>
          Save
        </Button>
      }
    >
      <div class="ui-settings">
        <Card class="ui-card" padding={0}>
          <header class="ui-card-header">
            <div>
              <h2>Terminal title</h2>
              <p>Choose how session status appears in the terminal tab title.</p>
            </div>
          </header>
          <div class="ui-form">
            <div class="ui-field">
              <span>Title Icon</span>
              <CustomSelect
                class="title-icon-select"
                label="Title Icon"
                value={state.icon()}
                options={icons}
                disabled={Boolean(state.ctx.saving())}
                onSelect={state.setIcon}
              />
              <small>None hides status icons. Unicode and Emojis show working, attention, and finished states.</small>
            </div>
          </div>
        </Card>

        <Card class="ui-card" padding={0}>
          <header class="ui-card-header">
            <div>
              <h2>Attention</h2>
              <p>Control when the TUI asks for attention and how it notifies you.</p>
            </div>
          </header>
          <div class="ui-form attention-form">
            <Toggle
              label="Attention alerts"
              description="Turn on TUI attention events."
              checked={state.alert()}
              disabled={Boolean(state.ctx.saving())}
              onChange={() => state.setAlert(!state.alert())}
            />
            <Toggle
              label="Desktop notifications"
              description="Show desktop notifications when attention alerts fire."
              checked={state.notify()}
              disabled={Boolean(state.ctx.saving()) || !state.alert()}
              onChange={() => state.setNotify(!state.notify())}
            />
            <Toggle
              label="Sound"
              description="Play an attention sound when alerts fire."
              checked={state.sound()}
              disabled={Boolean(state.ctx.saving()) || !state.alert()}
              onChange={() => state.setSound(!state.sound())}
            />
            <label class="ui-field">
              <span>Volume</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={state.volume()}
                disabled={!state.alert()}
                onInput={(event) => state.setVolume(event.currentTarget.value)}
              />
              <small>Use a value from 0 to 1. The docs example uses 0.4.</small>
            </label>
          </div>
        </Card>
      </div>
    </ConfigPage>
  )
}
