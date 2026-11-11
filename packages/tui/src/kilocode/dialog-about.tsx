// Kilo `/about`: version, channel, runtime, config and project paths, connected providers, the default model and
// links, with a `c` action that copies the diagnostics block. Paths are masked while privacy mode is on.
import type { ConfigEntry, LocationRef } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { Keymap, type KeymapCommand } from "../context/keymap"
import { useTuiPaths } from "../context/runtime"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"
import { abbreviateHome } from "../util/path-format"
import { createGatewayDefaultModel } from "./default-model"
import { privacyMode, REDACTED_PATH } from "./pii"

const LINKS = [
  { label: "Docs", url: "https://kilo.ai/docs" },
  { label: "GitHub", url: "https://github.com/Kilo-Org/kilocode" },
  { label: "Issues", url: "https://github.com/Kilo-Org/kilocode/issues" },
  { label: "Discord", url: "https://kilo.ai/discord" },
] as const

const PATH_MAX = 60

/** `Bun <version>` under the Bun runtime, `Node <version>` otherwise. */
export function runtime() {
  const bun = (globalThis as { Bun?: { version?: string } }).Bun
  return bun?.version ? `Bun ${bun.version}` : `Node ${process.versions.node}`
}

/** Home-abbreviated and truncated to 60 characters, or the redaction marker in privacy mode. */
export function maskPath(raw: string | undefined, privacy: boolean, home: string) {
  if (privacy) return REDACTED_PATH
  if (raw === undefined || raw === "") return "(unknown)"
  const abbreviated = abbreviateHome(raw, home)
  return abbreviated.length > PATH_MAX ? `${abbreviated.slice(0, PATH_MAX - 1)}\u2026` : abbreviated
}

/** The config file in effect: the highest-precedence document that has a path (the API orders low to high). */
export function effectiveConfigPath(entries: readonly ConfigEntry[]) {
  return entries.findLast(
    (entry): entry is Extract<ConfigEntry, { type: "document" }> => entry.type === "document" && entry.path !== undefined,
  )?.path
}

export type DiagnosticsInput = {
  version: string
  channel: string
  runtime: string
  platform: string
  arch: string
  configPath: string | undefined
  projectPath: string
  providers: string
  defaultModel: string
  privacy: boolean
  home: string
}

export function diagnosticsLines(input: DiagnosticsInput) {
  const lines = [
    `Kilo CLI ${input.version} (${input.channel})`,
    `Runtime: ${input.runtime} (${input.platform}/${input.arch})`,
    `Config: ${maskPath(input.configPath, input.privacy, input.home)}`,
    `Project: ${maskPath(input.projectPath, input.privacy, input.home)}`,
    `Providers: ${input.providers}`,
    `Default model: ${input.defaultModel || "(none)"}`,
  ]
  if (input.privacy) lines.push("(paths hidden \u2014 privacy_mode is on)")
  return lines
}

export function diagnostics(input: DiagnosticsInput) {
  return diagnosticsLines(input).join("\n")
}

export function DialogAbout(props: { context: Plugin.Context }) {
  const context = props.context
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const clipboard = useClipboard()
  const paths = useTuiPaths()
  const location = (): LocationRef => context.location ?? context.data.location.default()
  const gatewayDefault = createGatewayDefaultModel()
  const [configPath, setConfigPath] = createSignal<string>()
  // Fail closed: mask until privacyMode() resolves, matching pii.ts where a failed read counts as on.
  const [privacy, setPrivacy] = createSignal(true)

  const providers = createMemo(() => {
    const connected = (context.data.location.integration.list(location()) ?? []).filter(
      (item) => item.connections.length > 0,
    )
    return connected.length ? connected.map((item) => item.id).join(", ") : "(none connected)"
  })

  const defaultModel = createMemo(() => {
    const model = gatewayDefault.current()
    if (!model) return "(none)"
    const info = (context.data.location.model.list(location()) ?? []).find(
      (item) => item.providerID === model.providerID && item.id === model.modelID,
    )
    return `${model.providerID}/${info?.name ?? model.modelID}`
  })

  const refresh = () => {
    void context.client.config.get({ location: location() }).then(
      (entries) => setConfigPath(effectiveConfigPath(entries)),
      () => setConfigPath(undefined),
    )
    void privacyMode(context.client, location()).then(setPrivacy)
  }

  onMount(() => {
    dialog.setSize("large")
    void context.data.location.integration.sync(location()).catch(() => undefined)
    refresh()
  })
  // The dialog stays open across config edits, so privacy and the config path follow them.
  onCleanup(context.data.on("config.updated", refresh))

  const input = (): DiagnosticsInput => ({
    version: context.app.version,
    channel: context.app.channel,
    runtime: runtime(),
    platform: process.platform,
    arch: process.arch,
    configPath: configPath(),
    projectPath: context.data.location.default().directory,
    providers: providers(),
    defaultModel: defaultModel(),
    privacy: privacy(),
    home: paths.home,
  })

  const copy = () => {
    void clipboard.write(diagnostics(input())).then(
      () => toast.show({ variant: "success", message: "Diagnostics copied" }),
      (error: unknown) =>
        toast.show({
          variant: "error",
          message: `Copy failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
    )
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Close about", group: "Dialog", run: () => dialog.clear() },
      { bind: "c", title: "Copy diagnostics", group: "Dialog", run: copy },
    ],
  }))

  const Row = (row: { label: string; value: string; muted?: boolean; shown?: boolean }) => (
    <Show when={row.shown ?? true}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted} width={16}>
          {row.label}
        </text>
        <text fg={row.muted ? theme.text.muted : theme.text.base} wrapMode="word">
          {row.value}
        </text>
      </box>
    </Show>
  )

  const configValue = () => maskPath(configPath(), privacy(), paths.home)

  return (
    <DialogLayout
      header={<DialogHeader title="About Kilo CLI" />}
      footer={{ actions: { primary: [{ title: "copy diagnostics", key: "c", onTrigger: copy }] } }}
    >
      <box gap={1}>
        <text fg={theme.text.muted} wrapMode="word">
          Open source AI coding agent. Access hundreds of models through Kilo Gateway.
        </text>

        <box>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Identity
          </text>
          <Row label="Version" value={context.app.version} />
          <Row label="Channel" value={context.app.channel} />
        </box>

        <box>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Runtime
          </text>
          <Row label="Runtime" value={`${runtime()} (${process.platform}/${process.arch})`} muted />
          <Row label="Config" value={configValue()} muted />
          <Row
            label="Project"
            value={maskPath(context.data.location.default().directory, privacy(), paths.home)}
            muted
          />
        </box>

        <box>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Provider
          </text>
          <Row label="Connected" value={providers()} />
          <Row label="Default model" value={defaultModel()} muted={defaultModel() === "(none)"} />
        </box>

        <box>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Links
          </text>
          <For each={LINKS}>
            {(link) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text.muted}>{link.label}:</text>
                <Link href={link.url} fg={theme.text.action.primary.selected}>
                  {link.url}
                </Link>
              </box>
            )}
          </For>
        </box>
      </box>
    </DialogLayout>
  )
}

// Registered by the Kilo command host (`kilocode.teams`) so `/about` shares that plugin's row. A separate
// builtin row would sort before `opencode.diffs` in the plugin list and push it out of the /plugins viewport,
// breaking the upstream session-panel test.
export function aboutCommand(context: Plugin.Context): KeymapCommand {
  return {
    id: "kilo.about",
    title: "About",
    description: "Show version, environment, and diagnostic info",
    group: "Kilo",
    palette: true,
    slash: { name: "about" },
    run: () => context.ui.dialog.show(() => <DialogAbout context={context} />),
  }
}
