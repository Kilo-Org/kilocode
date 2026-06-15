import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { CustomSelect, type SelectOption } from "../../components/CustomSelect"
import { SearchField } from "../../components/SearchField"
import { ConfigPage, ConfigTag as Tag } from "./ConfigPage"
import { type Theme, themeTitle, useTuiUiSettings } from "./state/ui"

const diffs = [
  { value: "auto", label: "Auto" },
  { value: "stacked", label: "Stacked" },
] satisfies SelectOption<"auto" | "stacked">[]

function ThemeSwatches(props: { swatches: string[] }) {
  return (
    <div class="theme-swatches" aria-hidden="true">
      <For each={props.swatches}>{(color) => <span class="theme-swatch" style={{ "background-color": color }} />}</For>
    </div>
  )
}

function ThemePreview(props: { item: Theme }) {
  return (
    <div class="theme-preview">
      <div>
        <strong>{themeTitle(props.item.id)}</strong>
        <span class="mono">{props.item.custom ? `${props.item.id} / custom` : props.item.id}</span>
      </div>
      <ThemeSwatches swatches={props.item.swatches} />
    </div>
  )
}

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

export function CliUiRoute() {
  const state = useTuiUiSettings()

  return (
    <ConfigPage
      title="CLI UI"
      description="Configure terminal UI preferences saved in tui.json."
      actions={
        <Button variant="primary" disabled={Boolean(state.ctx.saving()) || !state.dirty()} onClick={state.save}>
          Save
        </Button>
      }
    >
      <div class="ui-settings">
        <Card class="ui-card ui-theme-card" padding={0}>
          <header class="ui-card-header">
            <div>
              <h2>Theme</h2>
              <p>Choose the TUI palette. Custom theme IDs can still be typed in the selector search.</p>
            </div>
            <Button variant="secondary" disabled={Boolean(state.ctx.saving())} onClick={state.edit}>
              Change Theme
            </Button>
          </header>
          <div class="ui-card-body">
            <ThemePreview item={state.active()} />
          </div>
        </Card>

        <Card class="ui-card" padding={0}>
          <header class="ui-card-header">
            <div>
              <h2>Interaction</h2>
              <p>Control mouse capture, scrolling, and diff rendering behavior in the terminal.</p>
            </div>
          </header>
          <div class="ui-form">
            <label class="ui-field">
              <span>Diff style</span>
              <CustomSelect label="Diff style" value={state.diff()} options={diffs} onSelect={state.setDiff} />
              <small>Auto adapts to terminal width; stacked always uses a single-column diff.</small>
            </label>

            <label class="ui-field">
              <span>Scroll speed</span>
              <input
                type="number"
                min="0.001"
                step="0.25"
                value={state.speed()}
                onInput={(event) => state.setSpeed(event.currentTarget.value)}
              />
              <small>Default is 3. Use lower values for slower scrolling.</small>
            </label>

            <Toggle
              label="Mouse capture"
              description="Allow the TUI to receive mouse input. Defaults to on."
              checked={state.mouse()}
              disabled={Boolean(state.ctx.saving())}
              onChange={() => state.setMouse(!state.mouse())}
            />

            <Toggle
              label="Scroll acceleration"
              description="Enable macOS-style scroll acceleration."
              checked={state.accel()}
              disabled={Boolean(state.ctx.saving())}
              onChange={() => state.setAccel(!state.accel())}
            />
          </div>
        </Card>
      </div>

      <Show when={state.mode() === "theme"}>
        <div class="drawer-scrim" onClick={state.close} />
        <aside class="provider-drawer theme-drawer" aria-label="Theme selector">
          <header class="drawer-header">
            <div>
              <h2>Choose Theme</h2>
              <span>Select a built-in theme or type a custom theme ID in search.</span>
            </div>
            <Button variant="ghost" aria-label="Close theme selector" onClick={state.close}>
              X
            </Button>
          </header>

          <SearchField
            class="drawer-search"
            hideLabel={false}
            label="Filter themes"
            value={state.picker()}
            variant="drawer"
            placeholder="Search theme or type a custom ID"
            onValue={state.setPicker}
          />

          <div class="provider-picker theme-picker">
            <Show when={state.options().length} fallback={<p class="empty">No themes match this filter.</p>}>
              <For each={state.options()}>
                {(item) => (
                  <button
                    class="provider-option theme-option"
                    classList={{ selected: state.choice() === item.id }}
                    type="button"
                    onClick={() => state.select(item)}
                  >
                    <div>
                      <strong>{themeTitle(item.id)}</strong>
                      <span>{item.custom ? `${item.id} / custom theme` : item.id}</span>
                    </div>
                    <ThemeSwatches swatches={item.swatches} />
                  </button>
                )}
              </For>
            </Show>
          </div>

          <footer class="drawer-footer theme-footer">
            <ThemePreview item={state.selected()} />
            <div>
              <Button variant="ghost" onClick={state.close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={Boolean(state.ctx.saving()) || !state.choice()}
                onClick={state.saveTheme}
              >
                Save Theme
              </Button>
            </div>
          </footer>
        </aside>
      </Show>
    </ConfigPage>
  )
}
