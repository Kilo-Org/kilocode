/**
 * Locks in the reactive TUI config store used for hot reload. Keymap and theme consumers read
 * the store proxy reactively, so `set()` (driven by `global.config.updated`) must propagate new
 * keybinds/theme to tracked reads — otherwise the TUI would still require a restart.
 */
import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { createBindingLookup } from "@opentui/keymap/extras"
import { TuiKeybind } from "@tui/config/keybind"
import { TuiConfig } from "@tui/config"
import { KiloTuiConfig } from "@/kilocode/cli/cmd/tui/context/tui-config"
import { KiloTerminalTitle } from "@/kilocode/cli/cmd/tui/terminal-title"

function cfg(input: Partial<TuiConfig.Info>): TuiConfig.Info {
  return input as TuiConfig.Info
}

function resolve(input: TuiConfig.Info): TuiConfig.Resolved {
  const keybinds = TuiKeybind.parse(input.keybinds ?? {})
  return {
    ...input,
    title_icon: input.title_icon ?? "none",
    attention: {
      enabled: input.attention?.enabled ?? false,
      notifications: input.attention?.notifications ?? true,
      sound: input.attention?.sound ?? true,
      volume: input.attention?.volume ?? 0.4,
      sound_pack: input.attention?.sound_pack ?? "kilo.default",
      sounds: input.attention?.sounds ?? {},
    },
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: input.leader_timeout ?? 1_000,
    mouse: input.mouse ?? true,
  }
}

describe("KiloTuiConfig.makeStore", () => {
  test("reactive reads update when set() reconciles a new config", () => {
    const store = KiloTuiConfig.makeStore(resolve(cfg({ keybinds: { app_exit: "ctrl+c" }, theme: "kilo" })))

    const exits: Array<string | undefined> = []
    const themes: Array<string | undefined> = []
    const icons: Array<string | undefined> = []
    const titles: string[] = []
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      createEffect(() => exits.push(store.config.keybinds.get("app.exit")[0]?.key as string | undefined))
      createEffect(() => themes.push(store.config.theme))
      createEffect(() => icons.push(store.config.title_icon))
      createEffect(() =>
        titles.push(
          KiloTerminalTitle.format({ base: "Kilo CLI", indicator: "working", icon: store.config.title_icon }),
        ),
      )
    })

    // Initial tracked reads.
    expect(exits).toEqual(["ctrl+c"])
    expect(themes).toEqual(["kilo"])
    expect(icons).toEqual(["none"])
    expect(titles).toEqual(["Kilo CLI"])

    store.set(cfg({ keybinds: { app_exit: "ctrl+q", leader: "ctrl+x" }, theme: "nord", title_icon: "emojis" }))

    // Direct store reads reflect the update synchronously.
    expect(store.config.keybinds.get("app.exit")[0]?.key).toBe("ctrl+q")
    expect(store.config.keybinds.get("leader")[0]?.key).toBe("ctrl+x")
    expect(store.config.theme).toBe("nord")
    expect(store.config.title_icon).toBe("emojis")

    // Tracked reactive reads re-ran with the new values (the hot-reload contract).
    expect(exits).toEqual(["ctrl+c", "ctrl+q"])
    expect(themes).toEqual(["kilo", "nord"])
    expect(icons).toEqual(["none", "emojis"])
    expect(titles).toEqual(["Kilo CLI", "💭 Kilo CLI"])

    dispose()
  })

  test("set() restores the default title icon when the setting is removed", () => {
    const store = KiloTuiConfig.makeStore(resolve(cfg({ title_icon: "unicode" })))

    store.set(cfg({}))

    expect(store.config.title_icon).toBe("none")
  })

  test("set() does not re-notify a tracked read when its value is unchanged", () => {
    const store = KiloTuiConfig.makeStore(resolve(cfg({ keybinds: { app_exit: "ctrl+c" }, theme: "kilo" })))

    const exits: Array<string | undefined> = []
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      createEffect(() => exits.push(store.config.keybinds.get("app.exit")[0]?.key as string | undefined))
    })

    // Only the theme changes; the tracked keybind stays "ctrl+c".
    store.set(cfg({ keybinds: { app_exit: "ctrl+c" }, theme: "nord" }))

    expect(store.config.theme).toBe("nord")
    expect(exits).toEqual(["ctrl+c"])

    dispose()
  })
})
