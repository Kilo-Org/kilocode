/**
 * VS Code-specific tool registry overrides.
 * Wraps upstream tool renderers to inject VS Code sidebar preferences
 * (e.g. expanded by default) without duplicating render logic.
 *
 * Call registerVscodeToolOverrides() once at app startup, after the
 * upstream tool registrations have run (i.e. after importing message-part).
 */

import { createMemo, For, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { ToolRegistry, type ToolProps } from "@kilocode/kilo-ui/message-part"

/** Tools that should be open by default in the VS Code sidebar. */
const DEFAULT_OPEN_TOOLS = ["bash"]
const registered = new Set<string>()

const TITLE: Record<string, string> = {
  start: "Start background process",
  list: "List background processes",
  status: "Check background process",
  logs: "View background logs",
  stop: "Stop background process",
  restart: "Restart background process",
}
const STRUCTURED_ACTIONS = new Set(["start", "status", "stop", "restart"])
const STRUCTURED_KEYS = new Set(["id", "status", "pid", "cwd", "command", "last_output"])
const LABEL: Record<string, string> = {
  command: "Command",
  id: "Process id",
  last_output: "Last output",
  pid: "PID",
  status: "Status",
  cwd: "Cwd",
}

function text(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function action(input: Record<string, unknown>) {
  const value = text(input.action)
  if (!value) return "status"
  return value
}

function ready(input: Record<string, unknown>) {
  const value = input.ready
  if (!value || typeof value !== "object") return []
  const data = value as Record<string, unknown>
  return [text(data.port) ? ["Ports", text(data.port)!] : undefined].filter((item): item is [string, string] => !!item)
}

function structured(raw: string | undefined, enabled: boolean) {
  if (!enabled) return { rows: [], output: output(raw) }

  const lines = raw?.trimEnd().split("\n") ?? []
  const rows = lines.flatMap((line): [string, string][] => {
    const match = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!match || !STRUCTURED_KEYS.has(match[1])) return []
    const text = match[2].trim()
    if (!text) return []
    return [[match[1], text]]
  })
  const rest = lines.filter((line) => {
    const match = line.match(/^([a-z_]+):\s*(.*)$/)
    return !match || !STRUCTURED_KEYS.has(match[1])
  })

  return {
    rows: rows.map((row): [string, string] => [LABEL[row[0]] ?? row[0], row[1]]),
    output: output(rest.join("\n")),
  }
}

function find(rows: [string, string][], label: string) {
  return rows.find((row) => row[0] === label)?.[1]
}

function output(text?: string) {
  const value = text?.trimEnd()
  if (!value?.trim()) return undefined
  return value
}

function expanded(act?: string, status?: string, open?: boolean) {
  if (open !== undefined) return open
  if (act === "status") return status === "pending" || status === "running"
  return status === "pending" || status === "running" || status === "completed"
}

function BackgroundProcessTool(props: ToolProps) {
  const act = createMemo(() => action(props.input))
  const title = createMemo(() => TITLE[act()] ?? "Background process")
  const data = createMemo(() => structured(props.output, props.status === "completed" && STRUCTURED_ACTIONS.has(act())))
  const id = createMemo(() => find(data().rows, "Process id") ?? text(props.metadata.processID) ?? text(props.input.id))
  const status = createMemo(() => find(data().rows, "Status") ?? text(props.metadata.status))
  const command = createMemo(() => find(data().rows, "Command") ?? text(props.input.command))
  const cwd = createMemo(() => find(data().rows, "Cwd") ?? text(props.input.cwd))
  const rows = createMemo(() =>
    [
      command() ? ["Command", command()!] : undefined,
      text(props.input.description) ? ["Description", text(props.input.description)!] : undefined,
      id() ? ["Process id", id()!] : undefined,
      status() ? ["Status", status()!] : undefined,
      cwd() ? ["Cwd", cwd()!] : undefined,
      !cwd() && text(props.input.workdir) ? ["Workdir", text(props.input.workdir)!] : undefined,
      ...ready(props.input),
      ...data().rows.filter((row) => !["Command", "Process id", "Status", "Cwd"].includes(row[0])),
    ].filter((item): item is [string, string] => !!item),
  )

  return (
    <BasicTool
      {...props}
      icon="terminal"
      trigger={{
        title: title(),
        subtitle: command() ?? text(props.input.description) ?? id(),
        args: [],
      }}
      defaultOpen={expanded(act(), props.status, props.defaultOpen)}
      allowPendingToggle
    >
      <Show when={rows().length > 0 || data().output}>
        <div data-component="background-process-details">
          <Show when={rows().length > 0}>
            <div data-component="background-process-fields">
              <For each={rows()}>
                {(row) => (
                  <div data-slot="background-process-field">
                    <span data-slot="background-process-label">{row[0]}</span>
                    <span data-slot="background-process-value">{row[1]}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={data().output}>
            {(value) => (
              <div data-component="tool-output" data-variant="preview" data-scrollable>
                <pre data-slot="background-process-output">{value()}</pre>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </BasicTool>
  )
}

export function registerVscodeToolOverrides() {
  if (!registered.has("background_process")) {
    ToolRegistry.register({
      name: "background_process",
      render: BackgroundProcessTool,
    })
    registered.add("background_process")
  }

  for (const name of DEFAULT_OPEN_TOOLS) {
    if (registered.has(name)) continue
    const upstream = ToolRegistry.render(name)
    if (!upstream) continue

    ToolRegistry.register({
      name,
      render: (props) => <Dynamic component={upstream} {...props} defaultOpen={props.defaultOpen ?? true} />,
    })
    registered.add(name)
  }
}
