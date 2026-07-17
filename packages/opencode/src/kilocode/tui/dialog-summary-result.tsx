import path from "path"
import { For } from "solid-js"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useBindings } from "@tui/keymap"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { Filesystem } from "@/util/filesystem"
import * as Clipboard from "@tui/util/clipboard"
import { formatMarkdownTables } from "@tui/util/markdown"

const ACTIONS = ["copy", "export", "close"] as const
type Action = (typeof ACTIONS)[number]

function defaultFilename(sessionID: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return `session-summary-${sessionID.slice(0, 8)}-${today}.md`
}

function copySummary(
  dialog: DialogContext,
  toast: ReturnType<typeof useToast>,
  text: string,
  rerender: (copied: boolean) => void,
) {
  void Clipboard.copy(text)
    .then(() => {
      toast.show({ variant: "success", message: "Summary copied to clipboard" })
      rerender(true)
      dialog.clear()
    })
    .catch(() => {
      toast.show({ variant: "error", message: "Failed to copy summary" })
      rerender(false)
      dialog.clear()
    })
}

async function exportSummary(
  dialog: DialogContext,
  toast: ReturnType<typeof useToast>,
  text: string,
  sessionID: string,
  rerender: () => void,
) {
  const filename = await DialogPrompt.show(dialog, "Export summary", {
    placeholder: "filename.md",
    value: defaultFilename(sessionID),
  })
  if (filename === null) {
    rerender()
    return
  }
  const trimmed = filename.trim()
  if (!trimmed) {
    toast.show({ variant: "error", message: "Filename is required" })
    rerender()
    return
  }
  const filepath = path.join(process.cwd(), trimmed)
  try {
    await Filesystem.write(filepath, text)
    toast.show({ variant: "success", message: `Summary exported to ${trimmed}` })
    dialog.clear()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write file"
    toast.show({ variant: "error", message })
    rerender()
  }
}

export function DialogSummaryResult(props: { text: string; sessionID: string; copied: boolean }) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme, syntax } = useTheme()
  const [store, setStore] = createStore({ active: "copy" as Action })
  const rendered = createMemo(() => formatMarkdownTables(props.text.trim()))

  const rerender = (copied: boolean) => {
    dialog.setSize("large")
    dialog.replace(() => (
      <DialogSummaryResult text={props.text} sessionID={props.sessionID} copied={copied} />
    ))
  }

  const run = (action: Action) => {
    if (action === "copy") copySummary(dialog, toast, props.text, rerender)
    if (action === "export") void exportSummary(dialog, toast, props.text, props.sessionID, () => rerender(props.copied))
    if (action === "close") dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      {
        key: "tab",
        desc: "Next summary action",
        group: "Dialog",
        cmd: () => {
          const i = ACTIONS.indexOf(store.active)
          setStore("active", ACTIONS[(i + 1) % ACTIONS.length])
        },
      },
      {
        key: "right",
        desc: "Next summary action",
        group: "Dialog",
        cmd: () => {
          const i = ACTIONS.indexOf(store.active)
          setStore("active", ACTIONS[(i + 1) % ACTIONS.length])
        },
      },
      {
        key: "left",
        desc: "Previous summary action",
        group: "Dialog",
        cmd: () => {
          const i = ACTIONS.indexOf(store.active)
          setStore("active", ACTIONS[(i - 1 + ACTIONS.length) % ACTIONS.length])
        },
      },
      {
        key: "return",
        desc: "Activate summary action",
        group: "Dialog",
        cmd: () => run(store.active),
      },
      {
        key: "c",
        desc: "Copy summary",
        group: "Dialog",
        cmd: () => run("copy"),
      },
      {
        key: "e",
        desc: "Export summary",
        group: "Dialog",
        cmd: () => run("export"),
      },
    ],
  }))

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text
          attributes={TextAttributes.BOLD}
          fg={props.copied ? theme.success : theme.warning}
        >
          {props.copied ? "✓ Copied to clipboard" : "⚠ Clipboard unavailable — use Export"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox flexGrow={1} height={20}>
        <markdown
          syntaxStyle={syntax()}
          streaming={false}
          internalBlockMode="top-level"
          content={rendered()}
          tableOptions={{ style: "grid" }}
          fg={theme.markdownText}
          bg={theme.background}
        />
      </scrollbox>
      <box flexDirection="row" justifyContent="flex-end" gap={1}>
        <For each={ACTIONS}>
          {(action) => (
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={action === store.active ? theme.primary : undefined}
              onMouseUp={() => run(action)}
            >
              <text
                fg={action === store.active ? theme.selectedListItemText : theme.textMuted}
                attributes={action === store.active ? TextAttributes.BOLD : undefined}
              >
                {action}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
