import { createEffect, createMemo, createSignal } from "solid-js"
import type { TuiPatch } from "../../../client"
import { useConfig } from "../../../context/config"
import { clean } from "../../../shared/utils"

export type Theme = {
  id: string
  swatches: string[]
  custom?: boolean
}

type Diff = "auto" | "stacked"
export type TitleIcon = NonNullable<TuiPatch["title_icon"]>

const fallback = ["#0c0a09", "#fafaf9", "#f9f76f", "#a6a09b", "#3794ff", "#44403b"]

export const themes: Theme[] = [
  { id: "aura", swatches: ["#0f0f0f", "#edecee", "#a277ff", "#f694ff", "#a277ff", "#2d2d2d"] },
  { id: "ayu", swatches: ["#0B0E14", "#BFBDB6", "#59C2FF", "#D2A6FF", "#E6B450", "#6C7380"] },
  { id: "carbonfox", swatches: ["#161616", "#f2f4f8", "#33b1ff", "#78a9ff", "#ff7eb6", "#303030"] },
  { id: "catppuccin", swatches: ["#1e1e2e", "#cdd6f4", "#89b4fa", "#cba6f7", "#f5c2e7", "#313244"] },
  {
    id: "catppuccin-frappe",
    swatches: ["#303446", "#c6d0f5", "#8da4e2", "#ca9ee6", "#f4b8e4", "#414559"],
  },
  {
    id: "catppuccin-macchiato",
    swatches: ["#24273a", "#cad3f5", "#8aadf4", "#c6a0f6", "#f5bde6", "#363a4f"],
  },
  { id: "cobalt2", swatches: ["#193549", "#ffffff", "#0088ff", "#9a5feb", "#2affdf", "#1f4662"] },
  { id: "colorblind", swatches: ["#1A1A2E", "#E8E8E8", "#0077BB", "#EE7733", "#33BBEE", "#1F4068"] },
  { id: "cursor", swatches: ["#181818", "#e4e4e4", "#88c0d0", "#81a1c1", "#88c0d0", "#e4e4e413"] },
  { id: "dracula", swatches: ["#282a36", "#f8f8f2", "#bd93f9", "#ff79c6", "#8be9fd", "#44475a"] },
  { id: "everforest", swatches: ["#2d353b", "#d3c6aa", "#a7c080", "#7fbbb3", "#d699b6", "#859289"] },
  { id: "flexoki", swatches: ["#100F0F", "#CECDC3", "#DA702C", "#4385BE", "#8B7EC8", "#575653"] },
  { id: "github", swatches: ["#0d1117", "#c9d1d9", "#58a6ff", "#bc8cff", "#39c5cf", "#30363d"] },
  { id: "gruvbox", swatches: ["#282828", "#ebdbb2", "#83a598", "#d3869b", "#8ec07c", "#665c54"] },
  { id: "kanagawa", swatches: ["#1F1F28", "#DCD7BA", "#7E9CD8", "#957FB8", "#D27E99", "#54546D"] },
  { id: "kilo", swatches: ["#0c0a09", "#fafaf9", "#f9f76f", "#a6a09b", "#f9f76f", "#44403b"] },
  { id: "kilo-v1", swatches: ["#1e1e1e", "#cccccc", "#faf74f", "#007acc", "#007fd4", "#3c3c3c"] },
  { id: "lucent-orng", swatches: ["#000000", "#eeeeee", "#EC5B2B", "#EE7948", "#FFF7F1", "#EC5B2B"] },
  { id: "material", swatches: ["#263238", "#eeffff", "#82aaff", "#c792ea", "#89ddff", "#37474f"] },
  { id: "matrix", swatches: ["#0a0e0a", "#62ff94", "#2eff6a", "#00efff", "#c770ff", "#1e2a1b"] },
  { id: "mercury", swatches: ["#171721", "#dddde5", "#8da4f5", "#a7b6f8", "#8da4f5", "#b4b7c81f"] },
  { id: "monokai", swatches: ["#272822", "#f8f8f2", "#66d9ef", "#ae81ff", "#a6e22e", "#3e3d32"] },
  { id: "nightowl", swatches: ["#011627", "#d6deeb", "#82AAFF", "#7fdbca", "#c792ea", "#5f7e97"] },
  { id: "nord", swatches: ["#2E3440", "#ECEFF4", "#88C0D0", "#81A1C1", "#8FBCBB", "#434C5E"] },
  { id: "one-dark", swatches: ["#282c34", "#abb2bf", "#61afef", "#c678dd", "#56b6c2", "#393f4a"] },
  { id: "opencode", swatches: ["#0a0a0a", "#eeeeee", "#fab283", "#5c9cf5", "#9d7cd8", "#484848"] },
  { id: "orng", swatches: ["#0a0a0a", "#eeeeee", "#EC5B2B", "#EE7948", "#FFF7F1", "#EC5B2B"] },
  { id: "osaka-jade", swatches: ["#111c18", "#C1C497", "#2DD5B7", "#D2689C", "#549e6a", "#3d4a44"] },
  { id: "palenight", swatches: ["#292d3e", "#a6accd", "#82aaff", "#c792ea", "#89ddff", "#32364a"] },
  { id: "rosepine", swatches: ["#191724", "#e0def4", "#9ccfd8", "#c4a7e7", "#ebbcba", "#403d52"] },
  { id: "solarized", swatches: ["#002b36", "#839496", "#268bd2", "#6c71c4", "#2aa198", "#073642"] },
  { id: "synthwave84", swatches: ["#262335", "#ffffff", "#36f9f6", "#ff7edb", "#b084eb", "#495495"] },
  { id: "tokyonight", swatches: ["#1a1b26", "#c8d3f5", "#82aaff", "#c099ff", "#ff966c", "#737aa2"] },
  { id: "vercel", swatches: ["#000000", "#EDEDED", "#0070F3", "#52A8FF", "#8E4EC6", "#1F1F1F"] },
  { id: "vesper", swatches: ["#101010", "#FFF", "#FFC799", "#99FFE4", "#FFC799", "#282828"] },
  { id: "zenburn", swatches: ["#3f3f3f", "#dcdccc", "#8cd0d3", "#dc8cc3", "#93e0e3", "#5f5f5f"] },
]

export function themeTitle(id: string) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}

function custom(id: string): Theme {
  return { id, swatches: fallback, custom: true }
}

function pick(value: unknown): Diff {
  if (value === "stacked") return "stacked"
  return "auto"
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value
  return fallback
}

export function useTuiUiSettings() {
  const ctx = useConfig()
  const current = createMemo(() => ctx.data()?.tui.theme ?? "kilo")
  const [theme, setTheme] = createSignal("")
  const [mode, setMode] = createSignal<"closed" | "theme">("closed")
  const [picker, setPicker] = createSignal("")
  const [choice, setChoice] = createSignal("")
  const [speed, setSpeed] = createSignal("3")
  const [accel, setAccel] = createSignal(false)
  const [diff, setDiff] = createSignal<Diff>("auto")
  const [mouse, setMouse] = createSignal(true)
  const [dirty, setDirty] = createSignal(false)

  const options = createMemo(() => {
    const term = clean(picker()).toLowerCase()
    const list = themes.filter((item) => {
      if (!term) return true
      return `${item.id} ${themeTitle(item.id)}`.toLowerCase().includes(term)
    })
    const raw = clean(picker())
    if (!raw || themes.some((item) => item.id === raw)) return list
    if (list.length) return list
    return [custom(raw)]
  })

  function item(id: string) {
    return themes.find((row) => row.id === id) ?? custom(id || "kilo")
  }

  const active = createMemo(() => item(theme()))
  const selected = createMemo(() => item(choice() || theme()))

  createEffect(() => {
    const tui = ctx.data()?.tui
    setTheme(current())
    if (dirty()) return
    setSpeed(String(tui?.scroll_speed ?? 3))
    setAccel(bool(tui?.scroll_acceleration?.enabled, false))
    setDiff(pick(tui?.diff_style))
    setMouse(bool(tui?.mouse, true))
  })

  function edit() {
    setChoice(theme())
    setPicker("")
    setMode("theme")
  }

  function close() {
    setMode("closed")
  }

  function select(value: Theme) {
    setChoice(value.id)
  }

  function change(run: () => void) {
    setDirty(true)
    run()
  }

  function saveTheme() {
    const id = clean(choice())
    if (!id) {
      ctx.fail("Select a TUI theme before saving.")
      return
    }
    ctx.tui({ theme: id })
    setTheme(id)
    close()
  }

  function save() {
    const scroll = Number(speed())
    if (!Number.isFinite(scroll) || scroll < 0.001) {
      ctx.fail("Enter a scroll speed of at least 0.001.")
      return
    }

    const patch: TuiPatch = {
      scroll_speed: scroll,
      scroll_acceleration: { enabled: accel() },
      diff_style: diff(),
      mouse: mouse(),
    }

    ctx.tui(patch)
    setDirty(false)
  }

  return {
    ctx,
    current,
    theme,
    active,
    selected,
    mode,
    picker,
    setPicker,
    choice,
    options,
    edit,
    close,
    select,
    saveTheme,
    speed,
    setSpeed: (value: string) => change(() => setSpeed(value)),
    accel,
    setAccel: (value: boolean) => change(() => setAccel(value)),
    diff,
    setDiff: (value: Diff) => change(() => setDiff(value)),
    mouse,
    setMouse: (value: boolean) => change(() => setMouse(value)),
    dirty,
    save,
  }
}

export function useTuiNotificationSettings() {
  const ctx = useConfig()
  const [alert, setAlert] = createSignal(false)
  const [notify, setNotify] = createSignal(true)
  const [sound, setSound] = createSignal(true)
  const [volume, setVolume] = createSignal("0.4")
  const [icon, setIcon] = createSignal<TitleIcon>("none")
  const [dirty, setDirty] = createSignal(false)

  createEffect(() => {
    if (dirty()) return
    const tui = ctx.data()?.tui
    const cfg = tui?.attention
    setAlert(bool(cfg?.enabled, false))
    setNotify(bool(cfg?.notifications, true))
    setSound(bool(cfg?.sound, true))
    setVolume(String(cfg?.volume ?? 0.4))
    setIcon(tui?.title_icon ?? "none")
  })

  function change(run: () => void) {
    setDirty(true)
    run()
  }

  function save() {
    const vol = Number(volume())
    if (!Number.isFinite(vol) || vol < 0 || vol > 1) {
      ctx.fail("Enter an attention volume between 0 and 1.")
      return
    }

    ctx.tui({
      title_icon: icon(),
      attention: {
        enabled: alert(),
        notifications: notify(),
        sound: sound(),
        volume: vol,
      },
    })
    setDirty(false)
  }

  return {
    ctx,
    alert,
    setAlert: (value: boolean) => change(() => setAlert(value)),
    notify,
    setNotify: (value: boolean) => change(() => setNotify(value)),
    sound,
    setSound: (value: boolean) => change(() => setSound(value)),
    volume,
    setVolume: (value: string) => change(() => setVolume(value)),
    icon,
    setIcon: (value: TitleIcon) => change(() => setIcon(value)),
    dirty,
    save,
  }
}
