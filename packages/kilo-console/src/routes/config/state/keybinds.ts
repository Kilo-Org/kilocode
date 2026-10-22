import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Snapshot, TuiPatch } from "../../../client"
import { useConfig } from "../../../context/config"
import { clean, csv } from "../../../shared/utils"

type Item = Snapshot["keybinds"]["keybinds"][number]

type Row = {
  item: Item
  binding: string
  source: "default" | "global" | "project"
  conflicts: string[]
}

const keys = new Set(["alt", "control", "meta", "shift"])

function norm(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, "")
}

function tokens(input: string) {
  if (norm(input) === "none") return []
  return csv(input).map(norm)
}

function key(input: string) {
  const lower = input.toLowerCase()
  if (lower === " ") return "space"
  if (lower === "arrowleft") return "left"
  if (lower === "arrowright") return "right"
  if (lower === "arrowup") return "up"
  if (lower === "arrowdown") return "down"
  if (lower === "escape") return "escape"
  if (lower === "enter") return "return"
  if (lower === "pageup") return "pageup"
  if (lower === "pagedown") return "pagedown"
  if (lower === "backspace") return "backspace"
  if (lower === "delete") return "delete"
  if (lower === "home") return "home"
  if (lower === "end") return "end"
  if (lower === "tab") return "tab"
  if (lower === "dead" || lower === "unidentified") return ""
  return lower
}

function combo(event: KeyboardEvent) {
  const name = key(event.key)
  if (!name || keys.has(name)) return ""
  return [event.ctrlKey && "ctrl", event.altKey && "alt", event.metaKey && "super", event.shiftKey && "shift", name]
    .filter(Boolean)
    .join("+")
}

export function useKeybindSettings() {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const [mode, setMode] = createSignal<"closed" | "edit">("closed")
  const [search, setSearch] = createSignal("")
  const [capture, setCapture] = createSignal(false)
  const [keybind, setKeybind] = createSignal("")
  const [binding, setBinding] = createSignal("")
  const keybinds = createMemo(() => snap()?.keybinds.keybinds ?? [])
  const ids = createMemo(() => new Set(keybinds().map((item) => item.id)))

  function current(item: Item) {
    return snap()?.tui.keybinds?.[item.id] ?? item.default
  }

  function duplicate(item: Item, value: string) {
    const set = new Set(tokens(value))
    if (!set.size) return []
    return keybinds()
      .filter((other) => other.id !== item.id && tokens(current(other)).some((token) => set.has(token)))
      .map((other) => other.id)
  }

  const rows = createMemo<Row[]>(() =>
    keybinds().map((item) => {
      const value = current(item)
      return {
        item,
        binding: value,
        source: value === item.default ? "default" : (ctx.query()?.scope ?? "project"),
        conflicts: value === item.default ? [] : duplicate(item, value),
      }
    }),
  )

  const visible = createMemo(() => {
    const q = search().trim().toLowerCase()
    if (!q) return rows()
    return rows().filter((row) =>
      `${row.item.label} ${row.item.id} ${row.item.group} ${row.item.description} ${row.binding} ${row.item.default}`
        .toLowerCase()
        .includes(q),
    )
  })

  const groups = createMemo(() =>
    Array.from(
      visible().reduce((map, row) => {
        const group = map.get(row.item.group) ?? []
        group.push(row)
        map.set(row.item.group, group)
        return map
      }, new Map<string, Row[]>()),
      ([name, rows]) => ({ name, rows }),
    ),
  )

  const selected = createMemo(() => keybinds().find((item) => item.id === keybind()))
  const conflicts = createMemo(() => {
    const item = selected()
    if (!item) return []
    if (clean(binding()) === item.default) return []
    return duplicate(item, binding())
  })

  const defaulted = createMemo(() => selected()?.default === clean(binding()))

  createEffect(() => {
    if (!capture()) return
    const handler = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      const value = combo(event)
      if (!value) return
      setBinding(value)
      setCapture(false)
    }
    window.addEventListener("keydown", handler, true)
    onCleanup(() => window.removeEventListener("keydown", handler, true))
  })

  function open(item: Item) {
    setKeybind(item.id)
    setBinding(current(item))
    setCapture(false)
    setMode("edit")
  }

  function close() {
    setCapture(false)
    setMode("closed")
  }

  function reset() {
    const item = selected()
    if (!item) return
    setBinding(item.default)
  }

  function none() {
    setBinding("none")
  }

  function save() {
    const name = clean(keybind())
    const value = clean(binding())
    if (!snap() || !name || !value) {
      ctx.fail("Enter a TUI keybind name and binding before saving.")
      return
    }
    if (!ids().has(name)) {
      ctx.fail(`Unknown TUI keybind: ${name}`)
      return
    }
    ctx.tui({ keybinds: { [name]: value } as NonNullable<TuiPatch["keybinds"]> })
    close()
  }

  return {
    ctx,
    mode,
    close,
    open,
    search,
    setSearch,
    capture,
    setCapture,
    keybinds,
    rows,
    visible,
    groups,
    selected,
    binding,
    setBinding,
    conflicts,
    defaulted,
    reset,
    none,
    save,
  }
}
