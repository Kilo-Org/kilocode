import type { Provider } from "@kilocode/sdk/v2"
import { Match, Switch, createMemo, createSignal, type Accessor, type Setter } from "solid-js"
import type { DialogContext } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { MainView } from "./tui"
import { ModelView, SettingsSelect } from "./models"
import { ProviderView } from "./providers"
import { AgentView } from "./agents"
import { PluginsView } from "./plugins"
import { DisabledProvidersView } from "./disabled-providers"
import { createSettings, type Scope, type SettingsState, type TuiPatch } from "./state"

export type View =
  | { name: "main" }
  | { name: "model"; field: "model" | "small_model" | "subagent_model"; title: string }
  | { name: "theme" }
  | { name: "choice"; field: "diff_style" | "title_icon" | "scroll_speed"; title: string }
  | { name: "provider"; id: string; title: string; source: Provider["source"] }
  | { name: "agent" }
  | { name: "plugins" }
  | { name: "disabledProviders" }

export function createSettingsDialog(dialog: DialogContext) {
  const ctx = createSettings()
  const [scope, setScope] = createSignal<Scope>("project")
  const [view, setView] = createSignal<View>({ name: "main" })

  return () => {
    setScope("project")
    setView({ name: "main" })
    void ctx.reload()
    // Dialog function children are reactive accessors and may reconstruct their component tree.
    // Keep the state in this stable app-owned controller so reconstruction cannot restart loading.
    dialog.replace(() => <SettingsBody ctx={ctx} scope={scope} setScope={setScope} view={view} setView={setView} />)
    dialog.setSize("large")
  }
}

function SettingsBody(props: {
  ctx: SettingsState
  scope: Accessor<Scope>
  setScope: Setter<Scope>
  view: Accessor<View>
  setView: Setter<View>
}) {
  const model = createMemo(() => {
    const current = props.view()
    return current.name === "model" ? current : undefined
  })
  const provider = createMemo(() => {
    const current = props.view()
    return current.name === "provider" ? current : undefined
  })
  const choice = createMemo(() => {
    const current = props.view()
    return current.name === "choice" ? current : undefined
  })

  return (
    <Switch>
      <Match when={props.view().name === "main"}>
        <MainView ctx={props.ctx} scope={props.scope} setScope={props.setScope} setView={props.setView} />
      </Match>
      <Match when={model()}>
        {(current) => (
          <ModelView
            ctx={props.ctx}
            view={current()}
            scope={props.scope()}
            back={() => props.setView({ name: "main" })}
          />
        )}
      </Match>
      <Match when={props.view().name === "theme"}>
        <ThemeView ctx={props.ctx} scope={props.scope()} back={() => props.setView({ name: "main" })} />
      </Match>
      <Match when={choice()}>
        {(current) => (
          <ChoiceView
            ctx={props.ctx}
            view={current()}
            scope={props.scope()}
            back={() => props.setView({ name: "main" })}
          />
        )}
      </Match>
      <Match when={provider()}>
        {(current) => <ProviderView ctx={props.ctx} view={current()} back={() => props.setView({ name: "main" })} />}
      </Match>
      <Match when={props.view().name === "agent"}>
        <AgentView ctx={props.ctx} scope={props.scope()} back={() => props.setView({ name: "main" })} />
      </Match>
      <Match when={props.view().name === "plugins"}>
        <PluginsView ctx={props.ctx} back={() => props.setView({ name: "main" })} />
      </Match>
      <Match when={props.view().name === "disabledProviders"}>
        <DisabledProvidersView ctx={props.ctx} back={() => props.setView({ name: "main" })} />
      </Match>
    </Switch>
  )
}

function ChoiceView(props: {
  ctx: SettingsState
  view: Extract<View, { name: "choice" }>
  scope: Scope
  back: () => void
}) {
  const data = choices(props.view.field)

  return (
    <SettingsSelect
      title={`Choose ${props.view.title.toLowerCase()}`}
      options={data.options}
      current={props.ctx.tui(props.view.field) ?? data.fallback}
      busy={props.ctx.store.busy}
      back={props.back}
      onSelect={async (option) => {
        const patch = ((): TuiPatch | undefined => {
          if (props.view.field === "diff_style") {
            if (option.value !== "auto" && option.value !== "stacked") return undefined
            return { diff_style: option.value }
          }
          if (props.view.field === "title_icon") {
            if (option.value !== "none" && option.value !== "unicode" && option.value !== "emojis") return undefined
            return { title_icon: option.value }
          }
          if (typeof option.value !== "number") return undefined
          return { scroll_speed: option.value }
        })()
        if (!patch) return
        const ok = await props.ctx.updateTui(props.scope, patch, props.view.title)
        if (ok) props.back()
      }}
    />
  )
}

function ThemeView(props: { ctx: SettingsState; scope: Scope; back: () => void }) {
  const themes = useTheme()
  const initial = themes.selected
  const [saved, setSaved] = createSignal(false)
  const options = Object.keys(themes.all())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((value) => ({ title: value, value }))

  return (
    <SettingsSelect
      title="Choose theme"
      options={options}
      current={readString(props.ctx.tui("theme")) ?? initial}
      busy={props.ctx.store.busy}
      back={() => {
        themes.set(initial)
        props.back()
      }}
      onMove={(option) => themes.set(option.value)}
      onSelect={async (option) => {
        const ok = await props.ctx.updateTui(props.scope, { theme: option.value }, "Theme")
        if (!ok) {
          themes.set(initial)
          return
        }
        setSaved(true)
        themes.set(option.value)
        props.back()
      }}
      onCleanup={() => {
        if (!saved()) themes.set(initial)
      }}
    />
  )
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function choices(field: Extract<View, { name: "choice" }>["field"]) {
  if (field === "diff_style") {
    return {
      fallback: "auto",
      options: [
        { title: "Automatic", description: "Use the available width to choose the layout.", value: "auto" },
        { title: "Stacked", description: "Always show additions and deletions vertically.", value: "stacked" },
      ],
    }
  }
  if (field === "title_icon") {
    return {
      fallback: "none",
      options: [
        { title: "None", description: "Do not add an icon to terminal titles.", value: "none" },
        { title: "Unicode", description: "Use simple text-compatible status icons.", value: "unicode" },
        { title: "Emoji", description: "Use colorful status icons.", value: "emojis" },
      ],
    }
  }
  return {
    fallback: 3,
    options: [
      { title: "1 · Slow", value: 1 },
      { title: "2", value: 2 },
      { title: "3 · Default", value: 3 },
      { title: "4", value: 4 },
      { title: "5 · Fast", value: 5 },
    ],
  }
}
