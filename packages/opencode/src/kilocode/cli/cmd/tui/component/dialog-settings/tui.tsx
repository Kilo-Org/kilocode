import { TextAttributes } from "@opentui/core"
import { Match, Switch, createMemo, type Accessor, type Setter } from "solid-js"
import type { DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { DialogProvider } from "@tui/component/dialog-provider"
import { Spinner } from "@tui/component/spinner"
import * as KiloProvider from "@/kilocode/cli/cmd/tui/component/dialog-provider"
import type { View } from "."
import type { Scope, SettingsState, TuiPatch } from "./state"

export function MainView(props: {
  ctx: SettingsState
  scope: Accessor<Scope>
  setScope: Setter<Scope>
  setView: Setter<View>
}) {
  const dialog = useDialog()
  const sync = useSync()
  const kv = useKV()
  const themes = useTheme()
  const theme = themes.theme

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const providers = sync.data.provider_next.all
      .filter((item) => sync.data.provider_next.connected.includes(item.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((provider) => ({
        title: provider.name,
        description: providerDescription(provider.id, provider.source, sync.data.provider_next.failed),
        category: "Providers",
        footer: sync.data.provider_next.failed.includes(provider.id) ? "needs attention" : "connected",
        value: `provider:${provider.id}`,
        gutter: () => (
          <text fg={sync.data.provider_next.failed.includes(provider.id) ? theme.error : theme.success}>●</text>
        ),
      }))

    const pluginCount = Array.isArray(props.ctx.tui("plugin")) ? (props.ctx.tui("plugin") as unknown[]).length : 0
    const disabledProvidersFooter = sync.data.provider_next.disabled.length
      ? `${sync.data.provider_next.disabled.length} hidden`
      : "none"

    return [
      {
        title: "Connect a provider",
        description: "Add an API key, sign in with OAuth, or configure a local provider.",
        category: "Providers",
        value: "connect",
      },
      ...providers,
      setting(
        "Disabled providers",
        "Providers hidden by disabled_providers. Restore them here.",
        "Providers",
        "disabledProviders",
        disabledProvidersFooter,
      ),
      setting(
        "Primary model",
        "Used for conversations and coding tasks.",
        "Models",
        "model",
        props.ctx.field("model", props.scope()),
        props.ctx.meta("model", props.scope()),
      ),
      setting(
        "Small model",
        "Used for lightweight tasks such as titles and summaries.",
        "Models",
        "small_model",
        props.ctx.field("small_model", props.scope()),
        props.ctx.meta("small_model", props.scope()),
      ),
      setting(
        "Subagent model",
        "Used for task subagents (defaults to the secondary/legacy model).",
        "Models",
        "subagent_model",
        props.ctx.field("subagent_model", props.scope()),
        props.ctx.meta("subagent_model", props.scope()),
      ),
      setting(
        "Default agent",
        "Agent used when a session does not specify one.",
        "Agents",
        "agent",
        agentLabel(sync, props.ctx.field("default_agent", props.scope())),
        props.ctx.meta("default_agent", props.scope()),
      ),
      {
        title: "Plugins",
        description: "Enable or disable registered TUI plugins.",
        category: "Plugins",
        value: "plugins",
        footer: pluginCount ? `${pluginCount} installed` : "none",
      },
      setting(
        "Theme",
        "Preview and choose the terminal color theme.",
        "Appearance",
        "theme",
        props.ctx.tui("theme") ?? themes.selected,
      ),
      setting(
        "Diff layout",
        "Choose automatic or always-stacked code diffs.",
        "Appearance",
        "diff",
        props.ctx.tui("diff_style") ?? "auto",
      ),
      setting(
        "Title icon",
        "Choose the status icon style used in terminal titles.",
        "Appearance",
        "icon",
        props.ctx.tui("title_icon") ?? "none",
      ),
      setting(
        "Mouse support",
        "Capture mouse clicks, selection, and scrolling.",
        "Interaction",
        "mouse",
        on(props.ctx.tui("mouse"), true),
      ),
      setting(
        "Vim editing",
        "Use Vim-style modal editing in the prompt.",
        "Interaction",
        "vim",
        on(props.ctx.tui("vim"), false),
      ),
      setting(
        "Animations",
        "Play fade and motion effects in the prompt.",
        "Interaction",
        "animations",
        on(kv.get("animations_enabled", true), true),
      ),
      setting(
        "Long paste summary",
        "Collapse long pastes into a one-line summary before sending.",
        "Interaction",
        "paste_summary",
        on(
          kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary),
          true,
        ),
      ),
      setting(
        "Wrap diffs",
        "Wrap long diff lines to fit the terminal width.",
        "Interaction",
        "diff_wrap",
        on(kv.get("diff_wrap_mode", "word") === "word", true),
      ),
      setting(
        "Scroll speed",
        "Set how far the interface moves on each scroll step.",
        "Interaction",
        "speed",
        props.ctx.tui("scroll_speed") ?? "3 · default",
      ),
      setting(
        "Scroll acceleration",
        "Accelerate repeated scrolling for smoother navigation.",
        "Interaction",
        "acceleration",
        on(acceleration(props.ctx.tui("scroll_acceleration")), false),
      ),
      setting(
        "Attention alerts",
        "Allow Kilo to notify you when a session needs input.",
        "Notifications",
        "attention",
        on(attention(props.ctx.tui("attention")).enabled, false),
      ),
      setting(
        "Desktop notifications",
        "Show an operating-system notification for attention alerts.",
        "Notifications",
        "notifications",
        on(attention(props.ctx.tui("attention")).notifications, true),
      ),
      setting(
        "Sounds",
        "Play a sound for attention alerts.",
        "Notifications",
        "sound",
        on(attention(props.ctx.tui("attention")).sound, true),
      ),
      setting(
        "Auto-approve",
        "Allow all tools without prompting for confirmation.",
        "Permissions",
        "autoApprove",
        on(props.ctx.isAutoApprove(), false),
      ),
    ]
  })

  function choose(value: string) {
    if (value === "connect") {
      dialog.replace(() => <DialogProvider scrollbar={true} />)
      return
    }
    if (value === "disabledProviders") {
      props.setView({ name: "disabledProviders" })
      return
    }
    if (value.startsWith("provider:")) {
      const id = value.slice("provider:".length)
      const provider = sync.data.provider_next.all.find((item) => item.id === id)
      props.setView({ name: "provider", id, title: provider?.name ?? id, source: provider?.source ?? "api" })
      return
    }
    if (value === "model" || value === "small_model" || value === "subagent_model") {
      props.setView({
        name: "model",
        field: value,
        title: value === "model" ? "Primary model" : value === "small_model" ? "Small model" : "Subagent model",
      })
      return
    }
    if (value === "agent") {
      props.setView({ name: "agent" })
      return
    }
    if (value === "plugins") {
      props.setView({ name: "plugins" })
      return
    }
    if (value === "theme") {
      props.setView({ name: "theme" })
      return
    }
    if (value === "diff") {
      props.setView({ name: "choice", field: "diff_style", title: "Diff layout" })
      return
    }
    if (value === "icon") {
      props.setView({ name: "choice", field: "title_icon", title: "Title icon" })
      return
    }
    if (value === "mouse") {
      void props.ctx.updateTui(props.scope(), { mouse: !readBool(props.ctx.tui("mouse"), true) }, "Mouse support")
      return
    }
    if (value === "vim") {
      void props.ctx.updateTui(props.scope(), { vim: !readBool(props.ctx.tui("vim"), false) }, "Vim editing")
      return
    }
    if (value === "animations") {
      const next = !kv.get("animations_enabled", true)
      kv.set("animations_enabled", next)
      return
    }
    if (value === "paste_summary") {
      const current = kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary)
      const next = !current
      kv.set("paste_summary_enabled", next)
      return
    }
    if (value === "diff_wrap") {
      const current = kv.get("diff_wrap_mode", "word")
      kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
      return
    }
    if (value === "speed") {
      props.setView({ name: "choice", field: "scroll_speed", title: "Scroll speed" })
      return
    }
    if (value === "acceleration") {
      const enabled = acceleration(props.ctx.tui("scroll_acceleration"))
      void props.ctx.updateTui(props.scope(), { scroll_acceleration: { enabled: !enabled } }, "Scroll acceleration")
      return
    }
    if (value === "attention" || value === "notifications" || value === "sound") {
      const current = attention(props.ctx.tui("attention"))
      const key = value === "attention" ? "enabled" : value
      const fallback = key !== "enabled"
      const patch = { ...current, [key]: !readBool(current[key], fallback) }
      void props.ctx.updateTui(props.scope(), { attention: patch }, label(value))
      return
    }
    if (value === "autoApprove") {
      void props.ctx.setAutoApprove(!props.ctx.isAutoApprove())
    }
  }

  return (
    <DialogSelect
      title="Settings"
      titleView={<Title scope={props.scope} setScope={props.setScope} />}
      placeholder="Search settings"
      options={options()}
      scrollbar={true}
      locked={props.ctx.store.loading || props.ctx.store.refreshing || props.ctx.store.busy !== undefined}
      onSelect={(option) => choose(option.value)}
      footer={<Status ctx={props.ctx} scope={props.scope} />}
      actions={[
        {
          command: "settings.scope",
          title: props.scope() === "project" ? "use global" : "use project",
          requiresSelection: false,
          onTrigger: () => props.setScope((scope) => (scope === "project" ? "global" : "project")),
        },
        {
          command: "settings.reload",
          title: "refresh",
          side: "right",
          requiresSelection: false,
          onTrigger: () => void props.ctx.reload(),
        },
      ]}
      bindings={[
        { key: "ctrl+g", cmd: "settings.scope" },
        { key: "ctrl+r", cmd: "settings.reload" },
      ]}
    />
  )
}

function Title(props: { scope: Accessor<Scope>; setScope: Setter<Scope> }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={2} alignItems="center">
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Settings
      </text>
      <box flexDirection="row" gap={1}>
        <ScopeButton label="project" active={props.scope() === "project"} onClick={() => props.setScope("project")} />
        <ScopeButton label="global" active={props.scope() === "global"} onClick={() => props.setScope("global")} />
      </box>
    </box>
  )
}

function ScopeButton(props: { label: string; active: boolean; onClick: () => void }) {
  const { theme } = useTheme()
  const foreground = selectedForeground(theme)
  return (
    <box
      backgroundColor={props.active ? theme.primary : theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={props.onClick}
    >
      <text fg={props.active ? foreground : theme.textMuted}>{props.label}</text>
    </box>
  )
}

function Status(props: { ctx: SettingsState; scope: Accessor<Scope> }) {
  const { theme } = useTheme()
  return (
    <Switch fallback={<text fg={theme.textMuted}>Changes save to {props.scope()} immediately</text>}>
      <Match when={props.ctx.store.loading}>
        <Spinner color={theme.textMuted}>Loading settings…</Spinner>
      </Match>
      <Match when={props.ctx.store.refreshing}>
        <Spinner color={theme.textMuted}>Refreshing…</Spinner>
      </Match>
      <Match when={props.ctx.store.busy}>{(label) => <Spinner color={theme.textMuted}>{label()}…</Spinner>}</Match>
      <Match when={props.ctx.store.error}>{(error) => <text fg={theme.error}>{error()}</text>}</Match>
      <Match when={props.ctx.store.notice}>{(notice) => <text fg={theme.success}>✓ {notice()}</text>}</Match>
      <Match when={props.ctx.store.warnings.length}>
        {(count) => (
          <text fg={theme.warning}>
            {count()} config warning{count() === 1 ? "" : "s"}
          </text>
        )}
      </Match>
    </Switch>
  )
}

function setting(
  title: string,
  description: string,
  category: string,
  value: string,
  current: unknown,
  source?: string,
): DialogSelectOption<string> {
  const display = typeof current === "string" || typeof current === "number" ? String(current) : "not set"
  return {
    title,
    description,
    category,
    value,
    footer: source ? `${display} · ${source}` : display,
  }
}

function providerDescription(id: string, source: string, failed: string[]) {
  if (failed.includes(id)) return KiloProvider.failedDescription(id, failed) ?? "The provider could not be loaded."
  if (source === "env") return "Connected through an environment variable."
  if (source === "config") return "Connected through the config file."
  return "Credentials are stored by Kilo."
}

function readBool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function agentLabel(sync: ReturnType<typeof useSync>, value: unknown) {
  if (typeof value !== "string" || !value) return "not set"
  const agent = sync.data.agent.find((item) => item.name === value)
  return agent?.displayName ?? value
}

function on(value: unknown, fallback: boolean) {
  return readBool(value, fallback) ? "on" : "off"
}

function acceleration(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return readBool(Object(value).enabled, false)
}

function attention(value: unknown): NonNullable<TuiPatch["attention"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as NonNullable<TuiPatch["attention"]>
}

function label(value: string) {
  if (value === "attention") return "Attention alerts"
  if (value === "notifications") return "Desktop notifications"
  return "Sounds"
}
