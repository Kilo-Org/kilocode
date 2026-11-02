import type { ToolFileContent } from "@opencode/client"
import { For, Show, createMemo, type JSX } from "solid-js"
import { BasicTool } from "../basic-tool"
import { FileIcon } from "../file-icon"
import { Markdown } from "../markdown"
import { TextShimmer } from "../text-shimmer"
import { busy } from "../tool-utils"
import type { ToolProps } from "../message-part"

const statuses = ["running", "completed", "error"] as const

type CallStatus = (typeof statuses)[number]

type NestedCall = {
  name: string
  server?: string
  status: CallStatus
  input?: Record<string, unknown>
}

/**
 * Rows for the nested calls a Code Mode script ran. The metadata carries only the call path, its
 * status and its input, so the row shows the path split into server and tool name. Per-call results
 * are not recorded; the script result is the card output.
 */
function nestedCalls(metadata: Record<string, unknown>): NestedCall[] {
  const value = metadata.toolCalls
  if (!Array.isArray(value)) return []
  return value.flatMap((item): NestedCall[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const call = item as Record<string, unknown>
    if (typeof call.tool !== "string" || call.tool === "") return []
    const status = statuses.find((entry) => entry === call.status)
    if (!status) return []
    const separator = call.tool.indexOf(".")
    const input = record(call.input)
    return [
      {
        name: separator < 0 ? call.tool : call.tool.slice(separator + 1),
        ...(separator < 0 ? {} : { server: call.tool.slice(0, separator) }),
        status,
        ...(input ? { input } : {}),
      },
    ]
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function argumentsText(input: Record<string, unknown> | undefined) {
  if (!input) return ""
  const args = Object.entries(input).flatMap(([key, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value)
    return text === undefined ? [] : [`${key}=${text.length > 80 ? text.slice(0, 77) + "..." : text}`]
  })
  return args.join(" ")
}

function fileName(file: ToolFileContent) {
  return file.name?.trim() || file.mime
}

function statusLabel(status: CallStatus) {
  if (status === "error") return "Error"
  if (status === "running") return "Running"
  return "Completed"
}

function callsLabel(count: number) {
  return `${count} ${count === 1 ? "call" : "calls"}`
}

const mono = { "font-family": "var(--font-family-mono)" }

const rootStyle = {
  display: "flex",
  "flex-direction": "column",
  gap: "8px",
  "padding-top": "4px",
} satisfies JSX.CSSProperties

const listStyle = { display: "flex", "flex-direction": "column", gap: "2px" } satisfies JSX.CSSProperties

const callStyle = {
  display: "flex",
  "align-items": "baseline",
  gap: "6px",
  "min-width": 0,
  "font-size": "var(--kilo-font-size-12)",
  color: "var(--text-base)",
} satisfies JSX.CSSProperties

const callNameStyle = {
  ...mono,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  color: "var(--text-base)",
} satisfies JSX.CSSProperties

const serverStyle = {
  flex: "0 0 auto",
  padding: "0 4px",
  border: "1px solid var(--border-weak-base)",
  "border-radius": "3px",
  color: "var(--text-weak)",
} satisfies JSX.CSSProperties

const argsStyle = {
  ...mono,
  flex: "1 1 auto",
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  color: "var(--text-weaker)",
} satisfies JSX.CSSProperties

const fileStyle = {
  display: "flex",
  "align-items": "center",
  gap: "6px",
  "font-size": "var(--kilo-font-size-12)",
  color: "var(--text-base)",
} satisfies JSX.CSSProperties

const mimeStyle = { color: "var(--text-weaker)" } satisfies JSX.CSSProperties

const sectionLabelStyle = {
  "margin-bottom": "2px",
  "font-size": "var(--kilo-font-size-12)",
  color: "var(--text-weak)",
} satisfies JSX.CSSProperties

const scriptStyle = {
  "font-size": "var(--kilo-font-size-12)",
  color: "var(--text-weak)",
} satisfies JSX.CSSProperties

const codeStyle = {
  ...mono,
  margin: "4px 0 0",
  padding: "6px 8px",
  overflow: "auto",
  border: "1px solid var(--border-weak-base)",
  "border-radius": "3px",
  "background-color": "var(--surface-inset-base)",
  color: "var(--text-base)",
} satisfies JSX.CSSProperties

function callStatusStyle(status: CallStatus): JSX.CSSProperties {
  return {
    flex: "0 0 auto",
    color: status === "error" ? "var(--text-critical-base, var(--text-weak))" : "var(--text-weak)",
  }
}

/**
 * `execute` card for Code Mode. The script runs nested MCP and custom tool calls in one step, so the
 * card lists each call the script made, then the files and final text it produced. The script source
 * stays available in a collapsed section after the result.
 */
export function ExecuteTool(props: ToolProps) {
  const calls = createMemo(() => nestedCalls(props.metadata))
  const failed = createMemo(() => props.metadata.error === true)
  const files = createMemo(() => props.attachments.filter((file) => file.type === "file"))
  const script = createMemo(() => {
    const code = props.input.code
    return typeof code === "string" ? code.trim() : ""
  })
  const output = createMemo(() => props.output.trim())
  return (
    <BasicTool
      {...props}
      icon="code"
      hasDetails
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text="Execute" active={busy(props.status)} />
            </span>
            <Show when={calls().length > 0}>
              <span data-slot="basic-tool-tool-subtitle">{callsLabel(calls().length)}</span>
            </Show>
            <Show when={failed()}>
              <span data-slot="execute-tool-error">Error</span>
            </Show>
          </div>
        </div>
      }
    >
      <div data-component="execute-tool" data-state={failed() ? "error" : "ok"} style={rootStyle}>
        <Show when={calls().length > 0}>
          <div data-slot="execute-tool-calls" style={listStyle}>
            <For each={calls()}>
              {(call) => (
                <div data-slot="execute-tool-call" data-status={call.status} style={callStyle}>
                  <span data-slot="execute-tool-call-name" style={callNameStyle}>
                    {call.name}
                  </span>
                  <Show when={call.server}>
                    {(server) => (
                      <span data-slot="execute-tool-call-server" style={serverStyle}>
                        {server()}
                      </span>
                    )}
                  </Show>
                  <span
                    data-slot="execute-tool-call-status"
                    data-status={call.status}
                    style={callStatusStyle(call.status)}
                  >
                    {statusLabel(call.status)}
                  </span>
                  <Show when={argumentsText(call.input)}>
                    {(args) => (
                      <code data-slot="execute-tool-call-arguments" style={argsStyle}>
                        {args()}
                      </code>
                    )}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={files().length > 0}>
          <div data-slot="execute-tool-files" style={listStyle}>
            <For each={files()}>
              {(file) => (
                <div data-slot="execute-tool-file" style={fileStyle}>
                  <FileIcon node={{ path: fileName(file), type: "file" }} />
                  <span data-slot="execute-tool-file-name">{fileName(file)}</span>
                  <Show when={file.name?.trim()}>
                    <span data-slot="execute-tool-file-mime" style={mimeStyle}>
                      {file.mime}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={output()}>
          <div data-slot="execute-tool-result">
            <div data-slot="execute-tool-section-label" style={sectionLabelStyle}>
              Output
            </div>
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          </div>
        </Show>
        <Show when={script()}>
          <details data-slot="execute-tool-script" style={scriptStyle}>
            <summary data-slot="execute-tool-script-summary">View code</summary>
            <pre data-slot="execute-tool-script-code" style={codeStyle}>
              <code>{script()}</code>
            </pre>
          </details>
        </Show>
      </div>
    </BasicTool>
  )
}
