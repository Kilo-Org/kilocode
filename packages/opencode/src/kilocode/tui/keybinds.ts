import { TuiKeybind } from "@/cli/cmd/tui/config/keybind"
import { Schema } from "effect"

export namespace KilocodeKeybinds {
  export const Info = Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    group: Schema.String,
    default: Schema.String,
    description: Schema.String,
  }).annotate({ identifier: "TuiKeybindInfo" })
  export type Info = Schema.Schema.Type<typeof Info>

  const groups: Record<string, string> = {
    agent: "Agents",
    app: "Application",
    command: "Commands",
    display: "Messages",
    editor: "Editor",
    history: "Input history",
    input: "Input",
    messages: "Messages",
    model: "Models",
    news: "Home",
    plugin: "Plugins",
    scrollbar: "Appearance",
    session: "Sessions",
    sidebar: "Appearance",
    stash: "Sessions",
    status: "Status",
    terminal: "Terminal",
    theme: "Appearance",
    tips: "Home",
    tool: "Tools",
    username: "Appearance",
    variant: "Models",
  }

  const acronyms = new Set(["tui"])

  function group(id: string) {
    const prefix = id.split("_")[0] ?? id
    return groups[prefix] ?? "General"
  }

  function word(input: string) {
    if (acronyms.has(input)) return input.toUpperCase()
    return input.charAt(0).toUpperCase() + input.slice(1)
  }

  function label(id: string) {
    return id.split("_").map(word).join(" ")
  }

  function fallback(id: string, value: unknown) {
    if (process.platform === "win32" && id === "terminal_suspend") return "none"
    if (value === false) return "none"
    if (Array.isArray(value)) return value.map((item) => String(item)).join(",")
    return String(value)
  }

  export function list(): Info[] {
    return Object.entries(TuiKeybind.Definitions).map(([id, definition]) => ({
      id,
      label: label(id),
      group: group(id),
      default: fallback(id, definition.default),
      description: definition.description,
    }))
  }
}
