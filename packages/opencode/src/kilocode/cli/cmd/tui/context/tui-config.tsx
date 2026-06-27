/**
 * Reactive TUI config provider with hot reload.
 *
 * Replaces the static upstream `TuiConfigProvider` so declarative TUI settings apply live when
 * changed from the Kilo Console. Fetched config stays serializable and is resolved into a fresh
 * OpenTUI keymap lookup before the reactive store is reconciled.
 */
import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { TuiKeybind } from "@/cli/cmd/tui/config/keybind"
import { KeymapLeaderTimeoutDefault } from "@/cli/cmd/tui/config/tui-schema"
import { createBindingLookup } from "@opentui/keymap/extras"
import { KiloTitleIcon } from "@/kilocode/cli/cmd/tui/title-icon"

export type SetTuiConfig = (next: TuiConfig.Info) => void

const ConfigContext = createContext<TuiConfig.Resolved>()
const SetContext = createContext<SetTuiConfig>()

export namespace KiloTuiConfig {
  // Pure factory so reactive behavior is unit-testable without JSX or contexts.
  export function makeStore(initial: TuiConfig.Resolved) {
    const [store, setStore] = createStore<TuiConfig.Resolved>(initial)
    const set: SetTuiConfig = (next) => {
      const keybinds = TuiKeybind.parse(next.keybinds ?? {})
      const config: TuiConfig.Resolved = {
        ...next,
        title_icon: next.title_icon ?? KiloTitleIcon.Default,
        attention: {
          enabled: next.attention?.enabled ?? false,
          notifications: next.attention?.notifications ?? true,
          sound: next.attention?.sound ?? true,
          volume: next.attention?.volume ?? 0.4,
          sound_pack: next.attention?.sound_pack ?? "kilo.default",
          sounds: next.attention?.sounds ?? {},
        },
        keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
          commandMap: TuiKeybind.CommandMap,
          bindingDefaults: TuiKeybind.bindingDefaults(),
        }),
        leader_timeout: next.leader_timeout ?? KeymapLeaderTimeoutDefault,
      }
      if (JSON.stringify(config.keybinds.bindings) === JSON.stringify(store.keybinds.bindings)) {
        config.keybinds = store.keybinds
      }
      setStore(reconcile(config, { merge: true }))
    }
    return { config: store, set }
  }

  export function Provider(props: ParentProps<{ config: TuiConfig.Resolved }>) {
    const store = makeStore(props.config)
    return (
      <ConfigContext.Provider value={store.config}>
        <SetContext.Provider value={store.set}>{props.children}</SetContext.Provider>
      </ConfigContext.Provider>
    )
  }

  export function use() {
    const value = useContext(ConfigContext)
    if (!value) throw new Error("TuiConfig context must be used within a context provider")
    return value
  }

  export function useSet() {
    const value = useContext(SetContext)
    if (!value) throw new Error("TuiConfig context must be used within a context provider")
    return value
  }
}
