// kilocode_change - new file
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { InstallationVersion, InstallationChannel, InstallationBuildKind } from "@opencode-ai/core/installation/version"
import { Global } from "@opencode-ai/core/global"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { useClipboard } from "@tui/context/clipboard"
import { useToast } from "@tui/ui/toast"
import { useBindings } from "@tui/keymap"
import { useTuiConfig } from "@tui/config"
import { getScrollAcceleration } from "@tui/util/scroll"

function runtime() {
  const rt = (globalThis as { Bun?: { version?: string } }).Bun
  return rt?.version ? `Bun ${rt.version}` : `Node ${process.versions.node}`
}

function arch() {
  return `${process.platform}/${process.arch}`
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text
}

function buildDiagnostics(input: {
  cwd: string
  projectRoot: string
  defaultModel: string
  provider: string
  mcp: number
  plugins: number
  agents: number
}) {
  return [
    `Kilo CLI ${InstallationVersion} (${InstallationChannel}, ${InstallationBuildKind})`,
    `Runtime: ${runtime()}`,
    `Platform: ${arch()}`,
    `TERM: ${process.env.TERM ?? ""}`,
    `Provider: ${input.provider}`,
    `Default model: ${input.defaultModel || "(none)"}`,
    `MCP servers: ${input.mcp}`,
    `Plugins: ${input.plugins}`,
    `Agents: ${input.agents}`,
    `Config: ${Global.Path.config}`,
    `CWD: ${input.cwd}`,
    `Project root: ${input.projectRoot}`,
  ].join("\n")
}

export function showAboutDialog(dialog: DialogContext) {
  dialog.setSize("large")
  dialog.replace(() => <DialogAbout />)
}

function Row(props: { label: string; value: string; theme: ReturnType<typeof useTheme>["theme"]; muted?: boolean }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.theme.textMuted} width={18}>
        {props.label}
      </text>
      <text fg={props.muted ? props.theme.textMuted : props.theme.text} wrapMode="word">
        {props.value}
      </text>
    </box>
  )
}

export function DialogAbout() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const project = useProject()
  const clipboard = useClipboard()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const config = useTuiConfig()
  const height = createMemo(() => Math.max(8, Math.min(28, Math.floor(dimensions().height * 0.7) - 5)))
  const scroll = createMemo(() => getScrollAcceleration(config))
  let box: ScrollBoxRenderable | undefined

  const provider = () => {
    const connected = sync.data.provider_next.connected
    return connected.length ? connected.join(", ") : "(none connected)"
  }

  const defaultModel = () => sync.data.config.model ?? ""
  const mcpCount = () => Object.keys(sync.data.mcp).length
  const plugins = () => sync.data.config.plugin ?? []
  const agentCount = () => sync.data.agent.filter((a) => !a.hidden).length
  const cwd = () => project.instance.path().directory || process.cwd()
  const projectRoot = () => project.data.project.mainDir ?? project.instance.path().directory ?? process.cwd()

  const links = [
    { label: "Docs", url: "https://kilo.ai/docs" },
    { label: "GitHub", url: "https://github.com/Kilo-Org/kilocode" },
    { label: "Issues", url: "https://github.com/Kilo-Org/kilocode/issues" },
    { label: "Discord", url: "https://kilo.ai/discord" },
  ]

  const diagnostics = () =>
    buildDiagnostics({
      cwd: cwd(),
      projectRoot: projectRoot(),
      defaultModel: defaultModel(),
      provider: provider(),
      mcp: mcpCount(),
      plugins: plugins().length,
      agents: agentCount(),
    })

  const copy = () => {
    if (!clipboard.write) {
      toast.show({ variant: "error", message: "Clipboard not available" })
      return
    }
    void clipboard.write(diagnostics()).then(
      () => toast.show({ variant: "success", message: "Diagnostics copied" }),
      (err: unknown) =>
        toast.show({
          variant: "error",
          message: `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
    )
  }

  useBindings(() => ({
    bindings: [
      { key: "escape", desc: "Close about", group: "Dialog", cmd: () => dialog.clear() },
      { key: "return", desc: "Close about", group: "Dialog", cmd: () => dialog.clear() },
      { key: "c", desc: "Copy diagnostics", group: "Dialog", cmd: copy },
      { key: "pageup", desc: "Scroll up", group: "Dialog", cmd: () => box?.scrollBy(-height()) },
      { key: "pagedown", desc: "Scroll down", group: "Dialog", cmd: () => box?.scrollBy(height()) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          About Kilo CLI
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(ref: ScrollBoxRenderable) => (box = ref)}
        height={height()}
        scrollAcceleration={scroll()}
        verticalScrollbarOptions={{ visible: true }}
        viewportOptions={{ paddingRight: 1 }}
      >
        <box gap={1}>
          <text fg={theme.textMuted} wrapMode="word">
            Open source AI coding agent. Access hundreds of models through Kilo Gateway.
          </text>

          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Identity
            </text>
            <Row theme={theme} label="Version" value={InstallationVersion} />
            <Row theme={theme} label="Channel" value={InstallationChannel} />
            <Row theme={theme} label="Build" value={InstallationBuildKind} muted />
            <Row theme={theme} label="License" value="MIT" muted />
          </box>

          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Runtime
            </text>
            <Row theme={theme} label="Runtime" value={runtime()} />
            <Row theme={theme} label="Platform" value={arch()} muted />
            <Row theme={theme} label="Terminal" value={truncate(process.env.TERM ?? "(unknown)", 40)} muted />
          </box>

          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Environment
            </text>
            <Row theme={theme} label="Config" value={truncate(Global.Path.config, 60)} muted />
            <Row theme={theme} label="Project" value={truncate(projectRoot(), 60)} muted />
            <Row theme={theme} label="CWD" value={truncate(cwd(), 60)} muted />
          </box>

          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Provider
            </text>
            <Row theme={theme} label="Connected" value={provider()} />
            <Row theme={theme} label="Default model" value={defaultModel() || "(none)"} muted={!defaultModel()} />
            <Row theme={theme} label="Agents" value={String(agentCount())} muted />
            <Row theme={theme} label="MCP servers" value={String(mcpCount())} muted />
            <Row theme={theme} label="Plugins" value={String(plugins().length)} muted />
          </box>

          <Show when={plugins().length > 0}>
            <box gap={0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Plugins
              </text>
              <For each={plugins().slice(0, 8)}>
                {(item) => (
                  <text fg={theme.textMuted}>
                    {"  • "}
                    {truncate(typeof item === "string" ? item : (item[0] ?? ""), 70)}
                  </text>
                )}
              </For>
            </box>
          </Show>

          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Links
            </text>
            <For each={links}>
              {(link) => (
                <text fg={theme.accent} wrapMode="word">
                  {"  "}
                  {link.label}: {link.url}
                </text>
              )}
            </For>
          </box>
        </box>
      </scrollbox>

      <box flexDirection="row" justifyContent="flex-start">
        <text fg={theme.textMuted} onMouseUp={copy}>
          c copy diagnostics
        </text>
      </box>
    </box>
  )
}
