import { Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { Spinner } from "@kilocode/kilo-web-ui/spinner"
import { CustomSelect, type SelectOption } from "../../components/CustomSelect"
import { ConfigPage } from "./ConfigPage"
import {
  MAX_CONTEXT_SIDEBAR_WIDTH,
  MIN_CONTEXT_SIDEBAR_WIDTH,
  type ConsoleDiffStyle,
  useConsoleUiSettings,
} from "./state/console"

const styles = [
  { value: "unified", label: "Unified" },
  { value: "split", label: "Split" },
] satisfies SelectOption<ConsoleDiffStyle>[]

export function ConsoleUiRoute() {
  const state = useConsoleUiSettings()

  return (
    <ConfigPage
      title="Console UI"
      description="Configure the local Kilo Console interface. These preferences are saved in your user config."
      actions={
        <>
          <Show when={state.configured()}>
            <Button variant="secondary" disabled={Boolean(state.ctx.saving())} onClick={state.reset}>
              Use default
            </Button>
          </Show>
          <Button
            variant="primary"
            disabled={Boolean(state.ctx.saving()) || !state.dirty()}
            aria-busy={Boolean(state.ctx.saving())}
            onClick={state.save}
          >
            <Show when={state.ctx.saving()}>
              <Spinner />
            </Show>
            Save
          </Button>
        </>
      }
    >
      <div class="ui-settings">
        <Card class="ui-card" padding={0}>
          <header class="ui-card-header">
            <div>
              <h2>Project context sidebar</h2>
              <p>Set the default width used by the Context and Changes panel in project consoles.</p>
            </div>
          </header>
          <div class="ui-form">
            <label class="ui-field">
              <span>Sidebar width</span>
              <input
                type="number"
                min={MIN_CONTEXT_SIDEBAR_WIDTH}
                max={MAX_CONTEXT_SIDEBAR_WIDTH}
                step="1"
                value={state.width()}
                onInput={(event) => state.setWidth(event.currentTarget.value)}
              />
              <small>
                Width in pixels, between {MIN_CONTEXT_SIDEBAR_WIDTH} and {MAX_CONTEXT_SIDEBAR_WIDTH}. You can also
                resize the sidebar by dragging its left edge.
              </small>
            </label>
          </div>
        </Card>
        <Card class="ui-card" padding={0}>
          <header class="ui-card-header">
            <div>
              <h2>Diff review</h2>
              <p>Choose the default layout used when reviewing changed files in project consoles.</p>
            </div>
          </header>
          <div class="ui-form">
            <div class="ui-field">
              <span>Diff layout</span>
              <CustomSelect
                class="console-diff-select"
                label="Diff layout"
                value={state.style()}
                options={styles}
                disabled={Boolean(state.ctx.saving())}
                onSelect={state.setStyle}
              />
              <small>
                Unified shows changes in one column. Split shows the original and modified file side by side.
              </small>
            </div>
          </div>
        </Card>
      </div>
    </ConfigPage>
  )
}
