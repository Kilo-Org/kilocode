import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { ConfigRow, SectionTitle } from "@kilocode/kilo-web-ui/console"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { SearchField } from "../../components/SearchField"
import { ConfigCountTag as CountTag, ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import { useKeybindSettings } from "./state/keybinds"

export function KeybindsRoute() {
  const state = useKeybindSettings()

  return (
    <ConfigPage
      title={
        <span class="config-title-count">
          Keybinds
          <CountTag>{state.keybinds().length}</CountTag>
        </span>
      }
      description="Review and override every terminal UI keybind command exposed by the CLI. Use none to disable a binding."
    >
      <SearchField
        label="Filter keybinds"
        value={state.search()}
        placeholder="Filter by command, group, binding, or description..."
        onValue={state.setSearch}
      />

      <div class="keybinds">
        <Show when={state.groups().length} fallback={<p class="empty">No keybinds match this filter.</p>}>
          <For each={state.groups()}>
            {(group) => (
              <section class="keybind-group">
                <SectionTitle trailing={<CountTag>{group.rows.length}</CountTag>}>{group.name}</SectionTitle>
                <div class="keybind-rows">
                  <For each={group.rows}>
                    {(row) => (
                      <ConfigRow
                        title={row.item.label}
                        subtitle={
                          <span class="keybind-subtitle">
                            <span class="keybind-id">{row.item.id}</span>
                            <span class="keybind-description">{row.item.description}</span>
                          </span>
                        }
                        status={
                          <div class="keybind-meta">
                            <span class="keybind-binding" data-empty={row.binding === "none" || undefined}>
                              {row.binding}
                            </span>
                            <SourceBadge source={row.source} />
                            <Show when={row.conflicts.length}>
                              <Tag tone="warning">Conflict</Tag>
                            </Show>
                          </div>
                        }
                        actions={
                          <IconButton
                            icon="edit"
                            variant="ghost"
                            aria-label={`Edit ${row.item.label}`}
                            disabled={Boolean(state.ctx.saving())}
                            onClick={() => state.open(row.item)}
                          />
                        }
                      />
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </div>

      <Show when={state.mode() === "edit" && state.selected()}>
        {(item) => (
          <>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer keybind-drawer" aria-label="Keybind configuration">
              <header class="drawer-header">
                <div>
                  <h2>{item().label}</h2>
                  <span>{item().id}</span>
                </div>
                <Button variant="ghost" aria-label="Close keybind overlay" onClick={state.close}>
                  X
                </Button>
              </header>

              <div class="provider-form keybind-form">
                <section class="keybind-command-card wide">
                  <span>{item().group}</span>
                  <p>{item().description}</p>
                  <code>{item().id}</code>
                </section>

                <label class="required-field wide keybind-binding-field">
                  Binding
                  <div class="keybind-input-row">
                    <input
                      value={state.binding()}
                      placeholder="ctrl+x,shift+return,none"
                      spellcheck={false}
                      onInput={(event) => state.setBinding(event.currentTarget.value)}
                    />
                    <Button
                      variant={state.capture() ? "primary" : "secondary"}
                      aria-pressed={state.capture()}
                      onClick={() => state.setCapture(!state.capture())}
                    >
                      {state.capture() ? "Listening..." : "Capture"}
                    </Button>
                  </div>
                </label>

                <p class="keybind-help wide">
                  Press Capture, then type a shortcut. Enter comma-separated bindings manually to define alternatives.
                </p>

                <div class="keybind-default-card wide">
                  <span>Default binding</span>
                  <code>{item().default}</code>
                </div>

                <Show when={state.conflicts().length}>
                  <p class="keybind-warning wide">Duplicate binding with: {state.conflicts().join(", ")}</p>
                </Show>
              </div>

              <footer class="drawer-footer keybind-footer">
                <Button variant="ghost" onClick={state.close}>
                  Cancel
                </Button>
                <Button variant="secondary" disabled={Boolean(state.ctx.saving())} onClick={state.none}>
                  Set none
                </Button>
                <Button
                  variant="secondary"
                  disabled={Boolean(state.ctx.saving()) || state.defaulted()}
                  onClick={state.reset}
                >
                  Use default
                </Button>
                <Button
                  variant="primary"
                  disabled={Boolean(state.ctx.saving()) || !state.binding()}
                  onClick={state.save}
                >
                  Save keybind
                </Button>
              </footer>
            </aside>
          </>
        )}
      </Show>
    </ConfigPage>
  )
}
