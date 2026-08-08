// kilocode_change - new file
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { InstallationVersion, InstallationChannel } from "@opencode-ai/core/installation/version"
import { Global } from "@opencode-ai/core/global"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { useClipboard } from "@tui/context/clipboard"
import { useToast } from "@tui/ui/toast"
import { useBindings } from "@tui/keymap"

function runtime() {
  const rt = (globalThis as { Bun?: { version?: string } }).Bun
  return rt?.version ? `Bun ${rt.version}` : `Node ${process.versions.node}`
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text
}

export function showAboutDialog(dialog: DialogContext) {
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

  const providers = () => {
    const connected = sync.data.provider_next.connected
    return connected.length ? connected.join(", ") : "(none connected)"
  }
  const defaultModel = () => sync.data.config.model ?? ""
  const projectRoot = () => project.data.project.mainDir ?? project.instance.path().directory ?? process.cwd()

  const links = [
    { label: "Docs", url: "https://kilo.ai/docs" },
    { label: "GitHub", url: "https://github.com/Kilo-Org/kilocode" },
    { label: "Issues", url: "https://github.com/Kilo-Org/kilocode/issues" },
    { label: "Discord", url: "https://kilo.ai/discord" },
  ]

  const copy = () => {
    if (!clipboard.write) {
      toast.show({ variant: "error", message: "Clipboard not available" })
      return
    }
    const text = [
      `Kilo CLI ${InstallationVersion} (${InstallationChannel})`,
      `Runtime: ${runtime()} (${process.platform}/${process.arch})`,
      `Config: ${Global.Path.config}`,
      `Project: ${projectRoot()}`,
      `Providers: ${providers()}`,
      `Default model: ${defaultModel() || "(none)"}`,
    ].join("\n")
    void clipboard.write(text).then(
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
        </box>

        <box gap={0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Runtime
          </text>
          <Row theme={theme} label="Runtime" value={`${runtime()} (${process.platform}/${process.arch})`} muted />
          <Row theme={theme} label="Config" value={truncate(Global.Path.config, 60)} muted />
          <Row theme={theme} label="Project" value={truncate(projectRoot(), 60)} muted />
        </box>

        <box gap={0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Provider
          </text>
          <Row theme={theme} label="Connected" value={providers()} />
          <Row theme={theme} label="Default model" value={defaultModel() || "(none)"} muted={!defaultModel()} />
        </box>

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

      <box flexDirection="row" justifyContent="flex-start">
        <text fg={theme.textMuted} onMouseUp={copy}>
          c copy diagnostics
        </text>
      </box>
    </box>
  )
}
