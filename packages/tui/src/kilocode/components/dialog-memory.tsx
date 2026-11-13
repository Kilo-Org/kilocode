import { TextAttributes } from "@opentui/core"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { MemoryAutosaveStatus } from "@kilocode/kilo-memory/autosave-status"
import { MEMORY_COMMAND_CATALOG } from "@kilocode/kilo-memory/commands"
import { MemoryToken } from "@kilocode/kilo-memory/token"
import { createResource, For, Match, Show, Switch, type JSX } from "solid-js"
import { useClient } from "../../context/client"
import { Keymap } from "../../context/keymap"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { DialogHeader, DialogLayout, useDialog, type DialogContext } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { errorMessage } from "../../util/error"
import { route } from "../memory-command"
import { relativeTime } from "../relative-time"

type Scope = { directory: string }
/** Puts a memory command draft into the prompt. Dialogs render outside the prompt's context, so the caller supplies it. */
type Draft = (text: string) => void

function fmt(value: number) {
  return value.toLocaleString()
}

function count(text: string) {
  return text.split("\n").filter((line) => line.trim().startsWith("- ")).length
}

function records(text: string) {
  return (text.match(/^record id=/gm) ?? []).length
}

function stored(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split(":: ").at(-1) ?? line)
    .slice(0, 16)
}

export function showMemoryDialog(dialog: DialogContext, input: Scope) {
  dialog.replace(() => <DialogMemory directory={input.directory} />, undefined, { size: "large" })
}

export function showMemoryHelpDialog(dialog: DialogContext, input: Scope & { reason?: string; draft: Draft }) {
  dialog.replace(
    () => <DialogMemoryHelp directory={input.directory} reason={input.reason} draft={input.draft} />,
    undefined,
    {
      size: "large",
    },
  )
}

export function showMemoryStatusDialog(dialog: DialogContext, input: Scope) {
  dialog.replace(() => <DialogMemoryStatus directory={input.directory} />, undefined, { size: "large" })
}

export function autosave(state: { autoConsolidate: boolean; stats: MemoryAutosaveStatus.Stats }) {
  const item = MemoryAutosaveStatus.summarize(state)
  if (item.state === "off") return "off"
  if (item.state === "watching") return "on · watching…"
  if (item.state === "saved") return `on · saved · ${relativeTime(item.at)}`
  if (item.state === "handoff") return `on · session handoff saved · ${relativeTime(item.at)}`
  return `on · no changes · ${relativeTime(item.at)}`
}

function useMemoryShow(props: Scope) {
  const client = useClient()
  const rpc = client.api.rpc(KiloMemoryRpc.Definition)
  return createResource(
    () => props.directory,
    (directory) => rpc.show({}, route({ directory })),
  )
}

function MemoryHeaderInfo(props: {
  root: string
  state: {
    enabled: boolean
    scope: string
  }
}) {
  const theme = useTheme().surface("dialog")
  const paths = useTuiPaths()
  return (
    <box>
      <Heading>{`${props.state.enabled ? "Enabled" : "Disabled"} · ${props.state.scope}`}</Heading>
      <text fg={theme.text.muted} wrapMode="word">
        {props.root.replace(paths.home, "~")}
      </text>
    </box>
  )
}

function MemorySourcesInfo(props: {
  sources: {
    project: string
    environment: string
    corrections: string
  }
}) {
  const theme = useTheme().surface("dialog")
  return (
    <box>
      <Heading>Sources</Heading>
      <text fg={theme.text.muted}>
        project.md {count(props.sources.project)} · environment.md {count(props.sources.environment)} · corrections.md{" "}
        {count(props.sources.corrections)}
      </text>
    </box>
  )
}

function MemoryItemsInfo(props: { items: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <box>
      <Heading>Stored memory</Heading>
      <Show when={stored(props.items).length > 0} fallback={<text fg={theme.text.muted}>No items</text>}>
        <For each={stored(props.items)}>{(line) => <text fg={theme.text.muted}>{line}</text>}</For>
      </Show>
    </box>
  )
}

export function draft(usage: string) {
  const head = usage.split(" ")[0]
  if (usage.includes("<") || usage.includes("|")) return `${head} `
  return usage
}

export function DialogMemoryHelp(props: { directory: string; reason?: string; draft: Draft }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const options: DialogSelectOption<string>[] = MEMORY_COMMAND_CATALOG.map((item) => ({
    title: item.description,
    footer: `/memory ${item.usage}`,
    value: item.usage,
  }))

  return (
    <DialogSelect
      title="Memory"
      options={options}
      flat
      footer={
        <Show when={props.reason}>{(reason) => <text fg={theme.text.feedback.error.base}>{reason()}</text>}</Show>
      }
      onSelect={(option) => {
        dialog.clear()
        props.draft(`/memory ${draft(option.value)}`)
      }}
    />
  )
}

function MemoryBody(props: {
  data: ReturnType<typeof useMemoryShow>[0]
  children: (item: KiloMemoryRpc.Show) => JSX.Element
}) {
  const theme = useTheme().surface("dialog")
  return (
    <Switch>
      <Match when={props.data.loading && !props.data.latest}>
        <text fg={theme.text.muted}>Loading memory...</text>
      </Match>
      <Match when={props.data.error}>
        <text fg={theme.text.feedback.error.base} wrapMode="word">
          {errorMessage(props.data.error)}
        </text>
      </Match>
      <Match when={props.data.latest}>{(item) => props.children(item())}</Match>
    </Switch>
  )
}

function useRefresh(refetch: () => unknown) {
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "ctrl+r", title: "Refresh memory", group: "Dialog", run: () => void refetch() }],
  }))
  return { title: "refresh", key: "ctrl+r", onTrigger: () => void refetch() }
}

function DialogMemoryStatus(props: Scope) {
  const theme = useTheme().surface("dialog")
  const [data, api] = useMemoryShow(props)
  const refresh = useRefresh(api.refetch)

  return (
    <DialogLayout header={<DialogHeader title="Memory status" />} footer={{ actions: { primary: [refresh] } }}>
      <MemoryBody data={data}>
        {(item) => (
          <box gap={1}>
            <MemoryHeaderInfo root={item.root} state={item.state} />
            <box>
              <Heading>Auto-save</Heading>
              <text fg={theme.text.muted}>{autosave(item.state)}</text>
              <text fg={theme.text.muted} wrapMode="word">
                Auto-save sends best-effort-redacted turn context to your configured model provider; disable with
                /memory auto off.
              </text>
            </box>
            <MemorySourcesInfo sources={item.sources} />
            <MemoryItemsInfo items={item.items} />
            <box>
              <Heading>Index</Heading>
              <text fg={theme.text.muted}>
                {fmt(records(item.index))} entries · {fmt(MemoryToken.estimate(item.index))} estimated tokens
              </text>
            </box>
          </box>
        )}
      </MemoryBody>
    </DialogLayout>
  )
}

export function DialogMemory(props: Scope) {
  const [data, api] = useMemoryShow(props)
  const refresh = useRefresh(api.refetch)

  return (
    <DialogLayout header={<DialogHeader title="Memory" />} footer={{ actions: { primary: [refresh] } }}>
      <MemoryBody data={data}>
        {(item) => (
          <box gap={1}>
            <MemoryHeaderInfo root={item.root} state={item.state} />
            <MemorySourcesInfo sources={item.sources} />
            <MemoryItemsInfo items={item.items} />
          </box>
        )}
      </MemoryBody>
    </DialogLayout>
  )
}

function Heading(props: { children: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
      {props.children}
    </text>
  )
}
