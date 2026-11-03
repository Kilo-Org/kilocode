import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  on,
  Show,
  Switch,
  type Component,
  type JSX,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type {
  FileDiffInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
  ToolFileContent,
} from "@opencode/client"
import { getDirectory, getFilename } from "@opencode/util/path"
import { checksum } from "@opencode/util/encode"
import { useClipboard } from "../context/clipboard"
import { useDialog } from "../context/dialog"
import { useFileComponent } from "../context/file"
import { useI18n, type UiI18n } from "../context/i18n"
import { createAutoScroll } from "../hooks/create-auto-scroll"
import { Accordion } from "./accordion"
import { AgentAvatar, taskStatus } from "./agent-avatar"
import { BasicTool, initialOpen, rememberOpen, useToolApprovalLine } from "./basic-tool"
import { Card } from "./card"
import { attachmentUri, fileDiffs, relativizeProjectPath, toolOutput } from "./content-data"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"
import { ImagePreview } from "./image-preview"
import { Markdown } from "./markdown"
import { ReasoningContent } from "./reasoning-content"
import { normalize } from "./session-diff"
import { ShellOutput } from "./shell-output"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { TextShimmer } from "./text-shimmer"
import { ToolApprovalProvider, resolveToolApproval } from "./tool-approval"
import { useToolChildSession } from "./tool-child-session"
import { readToolOpen, toolOpenKey } from "./tool-open-state"
import { busy, createThrottledValue, STREAMING_TEXT_RENDER_THROTTLE_MS, TEXT_RENDER_THROTTLE_MS } from "./tool-utils"
import { Tooltip } from "./tooltip"
import { ChartTool } from "./tools/chart"
import { ExecuteTool } from "./tools/execute"
import { ImageTool } from "./tools/image"
import { PlanTool } from "./tools/plan"

export { ToolApprovalProvider, resolveToolApproval, ToolApprovalVisibilityProvider } from "./tool-approval"
export { useGrowIn } from "./tool-utils"
export type { ReasoningDisplay } from "./reasoning-open"
export { relativizeProjectPath } from "./content-data"

/** A single-file diff as a renderer passes it to `ToolActions.openDiff`. */
export type ToolActionDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
}

/** Host actions a tool renderer may call. Every action is optional: a client without one renders without it. */
export type ToolActions = {
  openFile?: (path: string, line?: number) => void
  openDiff?: (diff: ToolActionDiff) => void
  /** Opens several changed files at once, for a patch that changes more than one. */
  openDiffs?: (diffs: ToolActionDiff[]) => void
  openSession?: (sessionID: string) => void
  /** Ends the child execution for the stop action of a running subagent. */
  interruptSession?: (sessionID: string) => void
  /** Moves the open session's foreground tools into background observation, so a subagent keeps running. */
  continueInBackground?: () => void
}

export type ContentPartProps = {
  item: SessionMessageAssistant["content"][number]
  message: SessionMessageAssistant
  index: number
  directory?: string
  open?: (uri: string) => void
  copy?: boolean
  settled?: boolean
  defaultOpen?: boolean
  /** Turn generation rate shown in the action row of the copy-carrying text part. */
  throughput?: JSX.Element
  /** Finish clock and turn duration shown in the same action row. */
  turnMeta?: JSX.Element
  actions?: ToolActions
  hideDetails?: boolean
  forceOpen?: boolean
  /** A recovery action for a failed tool call, such as a link to the settings that own the failure. */
  errorAction?: (error: { type: string; message: string }) => JSX.Element | undefined
}

export function ContentPart(props: ContentPartProps) {
  return (
    <Switch>
      <Match when={props.item.type === "text" && props.item}>
        {(item) => (
          <TextContent
            text={item().text}
            id={`${props.message.id}:${props.index}`}
            streaming={props.message.time.completed === undefined}
            copy={props.copy}
            throughput={props.throughput}
            turnMeta={props.turnMeta}
            open={props.open}
          />
        )}
      </Match>
      <Match when={props.item.type === "reasoning" && props.item}>
        {(item) => (
          <ReasoningContent
            item={item()}
            id={`${props.message.id}:${props.index}`}
            settled={props.settled || props.message.time.completed !== undefined}
          />
        )}
      </Match>
      <Match when={props.item.type === "tool" && props.item}>
        {(item) => (
          <ToolContent
            item={item()}
            directory={props.directory}
            open={props.open}
            defaultOpen={props.defaultOpen}
            actions={props.actions}
            hideDetails={props.hideDetails}
            forceOpen={props.forceOpen}
            errorAction={props.errorAction}
          />
        )}
      </Match>
    </Switch>
  )
}

function TextContent(props: {
  text: string
  id: string
  streaming: boolean
  copy?: boolean
  throughput?: JSX.Element
  turnMeta?: JSX.Element
  open?: (uri: string) => void
}) {
  const i18n = useI18n()
  const clipboard = useClipboard()
  const [copied, setCopied] = createSignal(false)
  const text = createThrottledValue(
    () => props.text.trim(),
    () => (props.streaming ? STREAMING_TEXT_RENDER_THROTTLE_MS : TEXT_RENDER_THROTTLE_MS),
  )
  const copy = async () => {
    await clipboard.write(props.text.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const click = (event: MouseEvent) => {
    if (!props.open || !(event.target instanceof Element)) return
    const anchor = event.target.closest("a[href]")
    const href = anchor?.getAttribute("href")
    if (!href || !/^https?:\/\//i.test(href)) return
    event.preventDefault()
    props.open(href)
  }
  return (
    <Show when={text()}>
      <div data-component="text-part">
        <div data-slot="text-part-body">
          <Markdown text={text()} cacheKey={props.id} streaming={props.streaming} onClick={click} />
        </div>
        <Show when={props.copy || props.throughput || props.turnMeta}>
          <div data-slot="assistant-copy-wrapper">
            <Show when={props.copy}>
              <Tooltip
                value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
                placement="top"
                gutter={4}
              >
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="normal"
                  variant="ghost"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={copy}
                  aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
                />
              </Tooltip>
            </Show>
            <Show when={props.throughput}>{(el) => <span data-slot="assistant-throughput-inline">{el()}</span>}</Show>
            <Show when={props.turnMeta}>
              {(el) => (
                <span data-slot="assistant-turn-meta" class="cursor-default">
                  {el()}
                </span>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  partID: string
  output: string
  status: string
  attachments: ToolFileContent[]
  directory?: string
  openUrl?: (uri: string) => void
  defaultOpen?: boolean
  actions?: ToolActions
  hideDetails?: boolean
  forceOpen?: boolean
  /** Diff counts derived from streamed tool input until the final diff metadata arrives. */
  provisional?: { additions: number; deletions: number }
}

const renderers: Record<string, Component<ToolProps>> = {}

export const ToolRegistry = {
  register(input: { name: string; render: Component<ToolProps> }) {
    renderers[input.name] = input.render
    return input
  },
  render(name: string) {
    return renderers[name]
  },
}

// Strings that count while the model streams a tool input. Other fields show
// once the call starts running, so a trigger never reads a half-written path.
const STREAM_LIVE = new Set(["content", "command", "oldString", "newString", "patchText", "edits"])
// Large streamed strings only feed the provisional diff count. Keeping them out
// of the card input avoids rendering a file that is still arriving.
const STREAM_HIDDEN = new Set(["content", "oldString", "newString", "patchText", "edits"])

type InputScan = {
  depth: number
  str: boolean
  esc: boolean
  key: boolean
  expect: "key" | "colon" | "value" | "comma"
  name: string
  start: number
  safe: number
  open: boolean
  lit: boolean
  uni: number
}

/**
 * Reads the complete top-level fields of a tool input JSON object that the
 * server still streams. A value whose key is in `live` also comes back while
 * its string is open, so a provisional count can grow with the content.
 */
function partialInput(raw: string, live: ReadonlySet<string>) {
  const text = raw.trimStart()
  if (!text.startsWith("{")) return undefined
  const scan: InputScan = {
    depth: 0,
    str: false,
    esc: false,
    key: false,
    expect: "key",
    name: "",
    start: 0,
    safe: 1,
    open: false,
    lit: false,
    uni: -1,
  }
  for (let i = 0; i < text.length; i++) {
    if (scan.str) {
      scanString(scan, text, i)
      continue
    }
    if (scanOutside(scan, text, i)) return jsonRecord(text.slice(0, i + 1))
  }
  return scanFinish(scan, text, live)
}

function scanString(scan: InputScan, text: string, i: number) {
  const c = text[i]
  if (scan.esc) {
    scan.esc = false
    if (c === "u") scan.uni = i - 1
    return
  }
  if (c === "\\") {
    scan.esc = true
    return
  }
  if (c !== '"') return
  scan.str = false
  if (scan.depth !== 1) return
  if (scan.key) {
    scan.name = (jsonParse(text.slice(scan.start, i + 1)) as string | undefined) ?? ""
    scan.expect = "colon"
    return
  }
  scan.safe = i + 1
  scan.open = false
  scan.expect = "comma"
}

function scanOutside(scan: InputScan, text: string, i: number) {
  const c = text[i]
  if (c === '"') {
    scan.str = true
    if (scan.depth !== 1) return false
    scan.start = i
    scan.key = scan.expect === "key"
    scan.open = !scan.key
    return false
  }
  if (c === "{" || c === "[") {
    scan.depth++
    return false
  }
  if (c === "}" || c === "]") {
    scan.depth--
    if (scan.depth === 0) return true
    if (scan.depth === 1) {
      scan.safe = i + 1
      scan.expect = "comma"
    }
    return false
  }
  if (scan.depth === 1) scanTop(scan, c, i)
  return false
}

function scanTop(scan: InputScan, c: string, i: number) {
  const space = c === " " || c === "\n" || c === "\r" || c === "\t"
  if (scan.lit && (c === "," || space)) {
    scan.safe = i
    scan.lit = false
    scan.expect = "comma"
  }
  if (c === ":") scan.expect = "value"
  if (c === ",") scan.expect = "key"
  if (!space && scan.expect === "value" && c !== ":") scan.lit = true
}

function scanFinish(scan: InputScan, text: string, live: ReadonlySet<string>) {
  if (!(scan.str && scan.open && scan.depth === 1 && live.has(scan.name))) {
    return jsonRecord(text.slice(0, scan.safe) + "}")
  }
  // Close the open live string. Drop an escape that is not complete yet.
  const cut = scan.esc ? text.length - 1 : scan.uni >= 0 && scan.uni + 6 > text.length ? scan.uni : text.length
  return jsonRecord(text.slice(0, cut) + '"}')
}

function jsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function jsonRecord(text: string) {
  const value = jsonParse(text)
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function cardInput(parsed: Record<string, unknown> | undefined) {
  if (!parsed) return {}
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => !STREAM_HIDDEN.has(key)))
}

// Count lines like the final diff: a trailing newline does not start a new line.
function lineCount(text: string) {
  if (!text) return 0
  let count = text.endsWith("\n") ? 0 : 1
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++
  return count
}

/**
 * A provisional diff count from the arguments streamed so far. It can differ
 * from the final metadata because of context, replaceAll, or formatting.
 */
function provisionalChanges(tool: string, input: Record<string, unknown> | undefined) {
  if (!input) return undefined
  if (tool === "write" && typeof input.content === "string")
    return { additions: lineCount(input.content), deletions: 0 }
  if (tool !== "edit") return undefined
  const before = input.oldString
  const after = input.newString
  if (typeof before !== "string" && typeof after !== "string") return undefined
  return {
    additions: lineCount(typeof after === "string" ? after : ""),
    deletions: lineCount(typeof before === "string" ? before : ""),
  }
}

const ERROR_HINTS = [
  "oldString and newString are identical",
  "must match exactly, including whitespace",
  "matches for oldString, but expected exactly one",
]

function cleanError(message: string) {
  return message.replace("Error: ", "")
}

function errorHint(error: { message: string }) {
  const cleaned = cleanError(error.message)
  return ERROR_HINTS.some((hint) => cleaned.includes(hint)) ? cleaned : undefined
}

// The message title, as v1 showed it: the part before the first ": " when it
// is short enough to read as a heading. A long or empty message keeps the
// error type as its heading so the code and type never disappear.
function errorParts(error: { type: string; message: string; status?: number }) {
  const cleaned = cleanError(error.message)
  const code = error.status ? String(error.status) : undefined
  if (!cleaned) return { title: error.type, message: "", code }
  const [title, ...rest] = cleaned.split(": ")
  const message = rest.join(": ")
  const detail =
    code && new RegExp(`^${code}(?=\\s|$)`).test(message) ? message.slice(code.length).trimStart() : message
  if (!title || title.length >= 30) return { title: error.type, message: cleaned, code }
  return { title, message: detail, code }
}

function ToolContent(props: {
  item: SessionMessageAssistantTool
  directory?: string
  open?: (uri: string) => void
  defaultOpen?: boolean
  actions?: ToolActions
  hideDetails?: boolean
  forceOpen?: boolean
  errorAction?: (error: { type: string; message: string }) => JSX.Element | undefined
}) {
  const i18n = useI18n()
  const state = () => props.item.state
  const metadata = (): Record<string, unknown> => {
    const value = state()
    return "metadata" in value ? (value.metadata ?? {}) : {}
  }
  const streamed = createMemo(() => {
    const value = state()
    if (value.status !== "streaming") return undefined
    return partialInput(value.input, STREAM_LIVE)
  })
  const cardValues = createMemo(() => cardInput(streamed()))
  const input = (): Record<string, unknown> => {
    const value = state()
    if (value.status !== "streaming") return value.input
    return cardValues()
  }
  const provisional = createMemo(() => {
    const value = state()
    if (value.status === "streaming") return provisionalChanges(props.item.name, streamed())
    if (value.status === "running") return provisionalChanges(props.item.name, value.input)
    return undefined
  })
  const attachments = () => {
    const value = state()
    if (!("content" in value)) return []
    return value.content?.filter((item): item is ToolFileContent => item.type === "file") ?? []
  }
  const error = () => {
    const value = state()
    return value.status === "error" ? value.error : undefined
  }
  const dismissed = () => props.item.name === "question" && error()?.message.includes("dismissed this question")
  return (
    <Show when={props.item.name !== "question" || !busy(state().status)}>
      <div data-component="tool-part-wrapper" data-part-type="tool" data-tool={props.item.name}>
        <Show
          when={error() && !dismissed()}
          fallback={
            <ToolApprovalProvider
              value={() => resolveToolApproval(metadata(), (key, params) => i18n.t(key as never, params))}
            >
              <Dynamic
                component={ToolRegistry.render(props.item.name) ?? McpTool}
                input={input()}
                metadata={metadata()}
                tool={props.item.name}
                partID={props.item.id}
                output={toolOutput(props.item)}
                status={state().status === "streaming" ? "pending" : state().status}
                attachments={attachments()}
                directory={props.directory}
                openUrl={props.open}
                defaultOpen={props.defaultOpen}
                actions={props.actions}
                hideDetails={props.hideDetails}
                forceOpen={props.forceOpen}
                provisional={provisional()}
              />
            </ToolApprovalProvider>
          }
        >
          <Show
            when={error() && errorHint(error()!)}
            fallback={<ToolErrorCard error={error()!} errorAction={props.errorAction} />}
          >
            {(hint) => (
              <div data-component="tool-hint">
                <Icon name="arrow-right" size="small" />
                <span data-slot="tool-hint-message">{hint()}</span>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </Show>
  )
}

function ToolErrorCard(props: {
  error: { type: string; message: string; status?: number }
  errorAction?: (error: { type: string; message: string }) => JSX.Element | undefined
}) {
  const parts = () => errorParts(props.error)
  return (
    <Card variant="error">
      <div data-component="tool-error">
        <Icon name="circle-ban-sign" size="small" />
        <div data-slot="message-part-tool-error-content">
          <div data-slot="message-part-tool-error-heading">
            <div data-slot="message-part-tool-error-title">{parts().title}</div>
            <Show when={parts().code}>{(code) => <span data-slot="message-part-tool-error-code">{code()}</span>}</Show>
          </div>
          <Show when={parts().message}>
            {(message) => <span data-slot="message-part-tool-error-message">{message()}</span>}
          </Show>
          <Show when={props.errorAction?.(props.error)}>
            {(action) => <div data-slot="message-part-tool-error-action">{action()}</div>}
          </Show>
        </div>
      </div>
    </Card>
  )
}

function string(value: unknown) {
  return typeof value === "string" ? value : ""
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(record) : []
}

function ToolTriggerRow(props: {
  title: string
  pending: boolean
  subtitle?: string
  args?: string[]
  onClick?: (event: MouseEvent) => void
}) {
  const detail = () => [props.subtitle, ...(props.args ?? [])].filter(Boolean).join(" ")
  return (
    <div data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title">
          <TextShimmer text={props.title} active={props.pending} />
        </span>
        <Show when={detail()}>
          {(text) => (
            <span
              data-slot="basic-tool-tool-subtitle"
              classList={{ clickable: !!props.onClick }}
              onClick={props.onClick}
            >
              {text()}
            </span>
          )}
        </Show>
      </div>
    </div>
  )
}

function Output(props: { text: string; preview?: boolean }) {
  return (
    <Show when={props.text}>
      <div data-component="tool-output" data-variant={props.preview ? "preview" : undefined} data-scrollable>
        <Markdown text={props.text} />
      </div>
    </Show>
  )
}

function ToolLoadedFile(props: { text: string; onClick?: () => void }) {
  return (
    <div class="w-full min-w-0">
      <div data-component="tool-loaded-file" classList={{ clickable: !!props.onClick }} onClick={props.onClick}>
        <Icon name="enter" size="small" />
        <span>{props.text}</span>
      </div>
    </div>
  )
}

function McpTool(props: ToolProps) {
  const i18n = useI18n()
  const dialog = useDialog()
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name", "id"]
  const subtitle = () => keys.map((key) => string(props.input[key])).find(Boolean)
  // One extra argument, so a custom tool shows a primitive the label keys do not cover.
  const args = () =>
    Object.entries(props.input)
      .filter(([key]) => !keys.includes(key))
      .flatMap(([key, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [`${key}=${value}`] : [],
      )
      .slice(0, 1)
  const input = () =>
    Object.keys(props.input).length ? "```json\n" + JSON.stringify(props.input, null, 2) + "\n```" : ""
  const output = () => {
    if (!props.output) return ""
    const parsed = jsonParse(props.output)
    if (!parsed || typeof parsed !== "object") return props.output
    return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```"
  }
  const images = () => props.attachments.filter((file) => file.mime.startsWith("image/"))
  const files = () => props.attachments.filter((file) => !file.mime.startsWith("image/"))
  return (
    <BasicTool {...props} icon="mcp" trigger={{ title: props.tool, subtitle: subtitle(), args: args() }}>
      <Show when={input()}>
        <div data-slot="mcp-section-label">{i18n.t("ui.messagePart.mcp.input")}</div>
        <Output text={input()} />
      </Show>
      <Show when={output()}>
        <Show when={input()}>
          <div data-slot="mcp-tool-divider" />
        </Show>
        <div data-slot="mcp-section-label">{i18n.t("ui.messagePart.mcp.output")}</div>
        <Output text={output()} />
      </Show>
      <Show when={images().length}>
        <div data-slot="tool-read-images">
          <For each={images()}>
            {(file) => (
              <div
                data-slot="tool-read-image"
                onClick={() => dialog.show(() => <ImagePreview src={file.uri} alt={file.name ?? undefined} />)}
              >
                <img
                  data-slot="tool-read-image-img"
                  src={file.uri}
                  alt={file.name ?? i18n.t("ui.message.attachment.alt")}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={files().length}>
        <div data-slot="mcp-attachments">
          <For each={files()}>
            {(file) => (
              <div data-slot="mcp-attachment">
                <FileIcon node={{ path: file.name ?? "", type: "file" }} />
                <span>{file.name ?? i18n.t("ui.message.attachment.alt")}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </BasicTool>
  )
}

ToolRegistry.register({
  name: "read",
  render(props) {
    const i18n = useI18n()
    const dialog = useDialog()
    const path = () => string(props.input.path)
    const args = () =>
      ["offset", "limit"].flatMap((key) => (typeof props.input[key] === "number" ? [`${key}=${props.input[key]}`] : []))
    const line = () => (typeof props.input.offset === "number" ? props.input.offset : undefined)
    const images = () => props.attachments.filter((file) => file.mime.startsWith("image/"))
    const loaded = () => {
      const value = props.metadata.loaded
      if (!Array.isArray(value)) return []
      return value.filter((file): file is string => typeof file === "string")
    }
    return (
      <>
        <BasicTool
          {...props}
          hideDetails
          icon="glasses"
          trigger={
            <ToolTriggerRow
              title={i18n.t("ui.tool.read")}
              pending={busy(props.status)}
              subtitle={getFilename(path())}
              args={args()}
              onClick={
                props.actions?.openFile && path()
                  ? (event) => {
                      event.stopPropagation()
                      props.actions?.openFile?.(path(), line())
                    }
                  : undefined
              }
            />
          }
        />
        <For each={loaded()}>
          {(filepath) => (
            <ToolLoadedFile
              text={`${i18n.t("ui.tool.loaded")} ${relativizeProjectPath(filepath, props.directory)}`}
              onClick={props.actions?.openFile ? () => props.actions?.openFile?.(filepath) : undefined}
            />
          )}
        </For>
        <Show when={images().length}>
          <div data-slot="tool-read-images">
            <For each={images()}>
              {(file) => (
                <div
                  data-slot="tool-read-image"
                  onClick={() => dialog.show(() => <ImagePreview src={file.uri} alt={file.name ?? undefined} />)}
                >
                  <img
                    data-slot="tool-read-image-img"
                    src={file.uri}
                    alt={file.name ?? i18n.t("ui.message.attachment.alt")}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </>
    )
  },
})

ToolRegistry.register({
  name: "glob",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.glob")}
            pending={busy(props.status)}
            subtitle={relativizeProjectPath(string(props.input.path), props.directory)}
            args={props.input.pattern ? ["pattern=" + string(props.input.pattern)] : []}
          />
        }
      >
        <Output text={props.output} preview />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "grep",
  render(props) {
    const i18n = useI18n()
    const args = () =>
      ["pattern", "include"].flatMap((key) => (props.input[key] ? [`${key}=${string(props.input[key])}`] : []))
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.grep")}
            pending={busy(props.status)}
            subtitle={relativizeProjectPath(string(props.input.path), props.directory)}
            args={args()}
          />
        }
      >
        <Output text={props.output} preview />
      </BasicTool>
    )
  },
})

function WebfetchMeta(props: { url: string; open?: (uri: string) => void }) {
  const open = (event: MouseEvent) => {
    event.stopPropagation()
    if (!props.open) return
    event.preventDefault()
    props.open(props.url)
  }
  return (
    <span data-slot="webfetch-meta">
      <a
        data-slot="basic-tool-tool-subtitle"
        class="clickable subagent-link"
        title={props.url}
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={open}
      >
        {props.url}
      </a>
      <div data-component="tool-action" onClick={open} style={{ cursor: "pointer" }}>
        <Icon name="square-arrow-top-right" size="small" />
      </div>
    </span>
  )
}

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        hideDetails
        icon="window-cursor"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.webfetch")} active={busy(props.status)} />
              </span>
              <Show when={string(props.input.url)}>{(url) => <WebfetchMeta url={url()} open={props.openUrl} />}</Show>
            </div>
          </div>
        }
      />
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  render(props) {
    const i18n = useI18n()
    const links = () => [
      ...new Set(
        [...props.output.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((item) => item[0].replace(/[),.;:!?]+$/g, "")),
      ),
    ]
    return (
      <BasicTool
        {...props}
        icon="window-cursor"
        trigger={{
          title: i18n.t("ui.tool.websearch"),
          subtitle: string(props.input.query),
          subtitleClass: "exa-tool-query",
        }}
      >
        <Show when={links().length}>
          <div data-component="exa-tool-output">
            <div data-slot="exa-tool-links">
              <For each={links()}>
                {(url) => (
                  <a
                    data-slot="exa-tool-link"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => {
                      if (!props.openUrl) return
                      event.preventDefault()
                      props.openUrl(url)
                    }}
                  >
                    {url}
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

function agentTitle(i18n: UiI18n, type: string | undefined) {
  if (!type) return i18n.t("ui.tool.agent.default")
  return i18n.t("ui.tool.agent", { type: type[0]!.toUpperCase() + type.slice(1) })
}

function childToolInfo(
  i18n: UiI18n,
  tool: string,
  input: Record<string, unknown>,
): { icon: IconProps["name"]; title: string; subtitle?: string } {
  const path = string(input.filePath) || string(input.path)
  switch (tool) {
    case "read":
      return { icon: "glasses", title: i18n.t("ui.tool.read"), subtitle: path ? getFilename(path) : undefined }
    case "list":
      return { icon: "bullet-list", title: i18n.t("ui.tool.list"), subtitle: path ? getFilename(path) : undefined }
    case "glob":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.glob"),
        subtitle: string(input.pattern) || undefined,
      }
    case "grep":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.grep"),
        subtitle: string(input.pattern) || undefined,
      }
    case "webfetch":
      return { icon: "window-cursor", title: i18n.t("ui.tool.webfetch"), subtitle: string(input.url) || undefined }
    case "websearch":
      return { icon: "window-cursor", title: i18n.t("ui.tool.websearch"), subtitle: string(input.query) || undefined }
    case "shell":
      return {
        icon: "console",
        title: i18n.t("ui.tool.shell"),
        subtitle: string(input.description) || string(input.command) || undefined,
      }
    case "edit":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.edit"),
        subtitle: path ? getFilename(path) : undefined,
      }
    case "write":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.write"),
        subtitle: path ? getFilename(path) : undefined,
      }
    case "patch":
      return { icon: "code-lines", title: i18n.t("ui.tool.patch") }
    case "todowrite":
      return { icon: "checklist", title: i18n.t("ui.tool.todos") }
    case "question":
      return { icon: "bubble-5", title: i18n.t("ui.tool.questions") }
    case "skill":
      return { icon: "brain", title: i18n.t("ui.tool.skill"), subtitle: string(input.name) || undefined }
    case "subagent":
      return {
        icon: "task",
        title: agentTitle(i18n, string(input.agent) || undefined),
        subtitle: string(input.description) || undefined,
      }
    default:
      return { icon: "mcp", title: tool }
  }
}

// A completed foreground child wraps its final text; a background start returns the model instruction instead.
function subagentResult(output: string, completed: boolean) {
  const text = output.trim()
  if (!text) return ""
  const match = /^<subagent\b[^>]*>\s*([\s\S]*?)\s*<\/subagent>$/.exec(text)
  if (match) return match[1]!.trim()
  return completed ? text : ""
}

ToolRegistry.register({
  name: "subagent",
  render(props) {
    const i18n = useI18n()
    const child = useToolChildSession()
    const childID = () => string(props.metadata.sessionID) || undefined
    const title = () => agentTitle(i18n, string(props.input.agent) || undefined)
    const description = () => string(props.input.description)
    // A background child completes its tool part at launch while the child keeps working.
    const background = () =>
      props.input.background === true || (props.status === "completed" && props.metadata.status === "running")
    const auto = () => props.status === "running" && !background()
    const stored = initialOpen({ tool: props.tool, partID: props.partID })
    const [open, setOpen] = createSignal(
      initialOpen({ tool: props.tool, partID: props.partID, defaultOpen: auto(), forceOpen: props.forceOpen }),
    )
    const [touched, setTouched] = createSignal(!!props.forceOpen || stored !== undefined)
    const [resolved, setResolved] = createSignal(false)
    const approvalLine = useToolApprovalLine()
    createEffect(
      on(
        childID,
        (id, previous) => {
          if (id && !previous) setResolved(true)
        },
        { defer: true },
      ),
    )
    createEffect(() => {
      if (touched()) return
      if (auto()) {
        setOpen(true)
        rememberOpen({ tool: props.tool, partID: props.partID }, true)
      } else if (background()) {
        setOpen(false)
        rememberOpen({ tool: props.tool, partID: props.partID }, false)
      }
    })
    createEffect(() => {
      const id = childID()
      if (!id || !open()) return
      child?.load(id)
    })
    const change = (value: boolean) => {
      setTouched(true)
      setOpen(value)
    }
    const avatar = () => {
      const id = childID()
      if (id && child?.running(id)) return "running" as const
      return taskStatus(props.status)
    }
    const canOpen = () => !!childID() && !!props.actions?.openSession
    const navigate = () => {
      const id = childID()
      const action = props.actions?.openSession
      if (!id || !action) return
      action(id)
    }
    const openChild = (event: MouseEvent) => {
      if (!canOpen()) return
      event.stopPropagation()
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate()
    }
    // The trigger is a button, so this modifier path keeps the open action reachable from the keyboard.
    const openChildFromTrigger = (event: MouseEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      navigate()
    }
    const tools = () => {
      const id = childID()
      return id && child ? child.tools(id) : []
    }
    const active = () => props.status === "running" && !background()
    const autoScroll = createAutoScroll({ working: () => active() })
    let viewport: HTMLDivElement | undefined
    let content: HTMLDivElement | undefined
    createEffect(() => {
      if (!open()) {
        autoScroll.scrollRef(undefined)
        autoScroll.contentRef(undefined)
        viewport = undefined
        content = undefined
        return
      }
      autoScroll.scrollRef(active() ? viewport : undefined)
      autoScroll.contentRef(active() ? content : undefined)
      if (!active() && viewport) viewport.scrollTop = 0
    })
    const stop = (event: { stopPropagation(): void }) => {
      event.stopPropagation()
      const id = childID()
      if (id) props.actions?.interruptSession?.(id)
    }
    const continueInBackground = (event: { stopPropagation(): void }) => {
      event.stopPropagation()
      props.actions?.continueInBackground?.()
    }
    // The card stop ends the child execution. Background jobs and background
    // subagents the child started need the scoped cancel API in #15724.
    const stoppable = () => !!childID() && avatar() === "running" && !!props.actions?.interruptSession
    // A running foreground child can move to background observation, matching the v1 task card.
    const promotable = () => !!childID() && !!props.actions?.continueInBackground && auto()
    const result = () => subagentResult(props.output, props.metadata.status === "completed")
    const label = () => description() || title()
    const count = () => tools().length
    const detail = () =>
      [description() ? title() : undefined, count() > 0 ? `(${count()})` : undefined].filter(Boolean).join(" ")
    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured" data-component="task-tool-heading">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title" title={label()}>
            <TextShimmer text={label()} active={busy(props.status)} />
          </span>
          <Show when={detail()}>{(text) => <span data-slot="basic-tool-tool-subtitle">{text()}</span>}</Show>
          <Show when={background()}>
            <span data-slot="task-tool-background">{i18n.t("task.backgroundAgents.untitled")}</span>
          </Show>
          {approvalLine()}
        </div>
        <Show when={stoppable()}>
          <Tooltip value={i18n.t("task.stop")} placement="top" gutter={4}>
            <span
              data-slot="task-tool-open"
              data-action="stop"
              title={i18n.t("task.stop")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={stop}
            >
              <Icon name="stop" size="small" />
            </span>
          </Tooltip>
        </Show>
        <Show when={promotable()}>
          <Tooltip value={i18n.t("task.backgroundAgents.continueInBackground")} placement="top" gutter={4}>
            <span
              data-slot="task-tool-open"
              data-action="background"
              title={i18n.t("task.backgroundAgents.continueInBackground")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={continueInBackground}
            >
              <Icon name="arrow-down-to-line" size="small" />
            </span>
          </Tooltip>
        </Show>
        <Show when={canOpen()}>
          <span data-slot="task-tool-open" title={`${i18n.t("task.open.panel")} (Cmd/Ctrl+Enter)`} onClick={openChild}>
            <Icon name="square-arrow-top-right" size="small" />
          </span>
        </Show>
      </div>
    )
    return (
      <BasicTool
        {...props}
        icon="task"
        iconNode={
          <span
            data-slot="task-agent-avatar"
            data-clickable={canOpen() ? "true" : undefined}
            data-resolve={resolved() ? "true" : undefined}
            onClick={openChild}
          >
            <AgentAvatar id={childID() ?? "unknown"} status={avatar()} />
          </span>
        }
        status={props.status}
        trigger={trigger()}
        onTriggerClick={openChildFromTrigger}
        approvalPlacement="hidden"
        allowPendingToggle
        defaultOpen={auto()}
        open={open()}
        forceOpen={props.forceOpen}
        defer={stored !== true}
        onOpenChange={change}
      >
        <div
          ref={(el) => {
            viewport = el
            autoScroll.scrollRef(active() ? el : undefined)
            if (!active()) el.scrollTop = 0
          }}
          onScroll={autoScroll.handleScroll}
          data-component="tool-output"
          data-scrollable
        >
          <div
            ref={(el) => {
              content = el
              autoScroll.contentRef(active() ? el : undefined)
            }}
            data-component="task-tools"
          >
            <Show when={props.status === "running" && !background() && tools().length === 0}>
              <div data-slot="task-tool-item" data-state="starting">
                <span data-slot="task-tool-title">{i18n.t("session.messages.taskStarting")}</span>
              </div>
            </Show>
            <For each={tools()}>
              {(tool) => {
                const info = () => childToolInfo(i18n, tool.name, record(tool.state.input) ? tool.state.input : {})
                return (
                  <div data-slot="task-tool-item">
                    <Icon name={info().icon} size="small" />
                    <span data-slot="task-tool-title">{info().title}</span>
                    <Show when={info().subtitle}>
                      {(subtitle) => <span data-slot="task-tool-subtitle">{subtitle()}</span>}
                    </Show>
                  </div>
                )
              }}
            </For>
            <Show when={result()}>{(text) => <Markdown text={text()} />}</Show>
          </div>
        </div>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "shell",
  render(props) {
    const i18n = useI18n()
    const [open, setOpen] = createSignal(readToolOpen(toolOpenKey(props), props.defaultOpen ?? true) ?? true)
    return (
      <BasicTool
        {...props}
        icon="console"
        hasDetails
        defaultOpen={props.defaultOpen ?? true}
        onOpenChange={setOpen}
        allowPendingToggle
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.shell")} active={busy(props.status)} />
              </span>
              <Show when={string(props.input.workdir)}>
                {(workdir) => (
                  <span data-component="shell-submessage">
                    <span data-slot="basic-tool-tool-subtitle">
                      <span data-slot="shell-submessage-value">{workdir()}</span>
                    </span>
                  </span>
                )}
              </Show>
            </div>
          </div>
        }
      >
        <ShellOutput
          cmd={string(props.input.command)}
          output={props.output || string(props.metadata.output)}
          active={open()}
          running={busy(props.status)}
        />
      </BasicTool>
    )
  },
})

function ToolFileAccordion(props: { path: string; directory?: string; actions?: JSX.Element; children: JSX.Element }) {
  return (
    <Accordion
      multiple
      data-scope="apply-patch"
      style={{ "--sticky-accordion-offset": "37px" }}
      defaultValue={[props.path || "tool-file"]}
    >
      <Accordion.Item value={props.path || "tool-file"}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div data-slot="apply-patch-trigger-content">
              <div data-slot="apply-patch-file-info">
                <FileIcon node={{ path: props.path, type: "file" }} />
                <div data-slot="apply-patch-file-name-container">
                  <Show when={props.path.includes("/")}>
                    <span data-slot="apply-patch-directory">
                      {`\u2066${relativizeProjectPath(getDirectory(props.path), props.directory)}\u2069`}
                    </span>
                  </Show>
                  <span data-slot="apply-patch-filename">{getFilename(props.path)}</span>
                </div>
              </div>
              <div data-slot="apply-patch-trigger-actions">
                {props.actions}
                <Icon name="chevron-grabber-vertical" size="small" />
              </div>
            </div>
          </Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content>{props.children}</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  )
}

function ToolFileMeta(props: {
  path: string
  directory?: string
  changes?: FileDiffInfo | { additions: number; deletions: number }
  fallback?: JSX.Element
}) {
  return (
    <Show when={props.path} fallback={props.fallback}>
      <span data-slot="message-part-meta-line" title={props.path}>
        <span data-slot="message-part-title-filename">{getFilename(props.path)}</span>
        <Show when={props.path.includes("/")}>
          <span data-slot="message-part-directory-inline">
            {relativizeProjectPath(getDirectory(props.path), props.directory)}
          </span>
        </Show>
        <Show when={props.changes}>{(changes) => <DiffChanges changes={changes()} />}</Show>
      </span>
    </Show>
  )
}

function ToolDiffAction(props: { when: boolean; onClick: (event: MouseEvent) => void }) {
  const i18n = useI18n()
  return (
    <Show when={props.when}>
      <span data-slot="tool-trigger-actions">
        <Tooltip value={i18n.t("ui.messagePart.openInDiffViewer")} placement="top" gutter={4}>
          <IconButton
            icon="square-arrow-top-right"
            size="small"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={props.onClick}
            aria-label={i18n.t("ui.messagePart.openInDiffViewer")}
          />
        </Tooltip>
      </span>
    </Show>
  )
}

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const component = useFileComponent()
    const diff = () => fileDiffs(props.metadata.files)[0]
    const path = () => diff()?.file || string(props.input.path)
    // While the call runs, the streamed input gives a provisional count until
    // the final diff metadata arrives.
    const streamed = () => (busy(props.status) ? props.provisional : undefined)
    // A plain function, not `createMemo`: a memo parses the patch with Pierre
    // on render, even while the card stays collapsed. Only the deferred body
    // and the diff action read it.
    const view = () => {
      const file = diff()
      if (file) return normalize(file)
      const before = string(props.input.oldString)
      const after = string(props.input.newString)
      if (!before && !after) return
      return normalize({ file: path(), before, after, additions: 0, deletions: 0 })
    }
    const canOpenDiff = () => {
      if (!props.actions?.openDiff || !path()) return false
      // Presence check instead of `view()` so the always-rendered trigger does
      // not parse the patch while the card stays collapsed.
      if (diff()?.patch) return true
      return !!(string(props.input.oldString) || string(props.input.newString))
    }
    const openDiff = (event: MouseEvent) => {
      event.stopPropagation()
      const value = view()
      if (!canOpenDiff() || !value) return
      props.actions?.openDiff?.({
        file: path(),
        patch: value.patch,
        additions: value.additions,
        deletions: value.deletions,
      })
    }
    return (
      <div data-component="edit-tool">
        <BasicTool
          {...props}
          revision={diff()?.patch ?? string(props.input.newString)}
          icon="code-lines"
          defer
          hasDetails
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={busy(props.status)} />
                  </span>
                  <ToolFileMeta path={path()} directory={props.directory} changes={diff() ?? streamed()} />
                </div>
              </div>
              <ToolDiffAction when={canOpenDiff()} onClick={openDiff} />
            </div>
          }
        >
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              directory={props.directory}
              actions={<Show when={diff()}>{(file) => <DiffChanges changes={file()} />}</Show>}
            >
              <div data-component="edit-content">
                <Show when={view()}>
                  {(value) => (
                    <Dynamic component={component} mode="diff" hunkSeparators="simple" fileDiff={value().fileDiff} />
                  )}
                </Show>
              </div>
            </ToolFileAccordion>
          </Show>
        </BasicTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    const i18n = useI18n()
    const component = useFileComponent()
    const diff = () => fileDiffs(props.metadata.files)[0]
    const path = () => string(props.input.path)
    // While the file streams, the input gives a provisional line count before
    // the final diff metadata exists.
    const streamed = () => (busy(props.status) ? props.provisional : undefined)
    // A write that leaves the file as it was has an empty diff: show only the header.
    const unchanged = () => {
      const file = diff()
      return !busy(props.status) && !!file && !file.additions && !file.deletions
    }
    const view = () => {
      const file = diff()
      // A large write arrives without a patch: show the written content instead.
      return file?.patch ? normalize(file) : undefined
    }
    // Cheap presence check instead of `view()` so a collapsed card never
    // parses its patch just to decide whether to show the button.
    const canOpenDiff = () => !!props.actions?.openDiff && !!path() && !!diff()?.patch
    const openDiff = () => {
      const value = view()
      if (!props.actions?.openDiff || !value) return
      props.actions.openDiff({
        file: value.file || path(),
        patch: value.patch,
        additions: value.additions,
        deletions: value.deletions,
      })
    }
    const handleOpenDiffClick = (event: MouseEvent) => {
      event.stopPropagation()
      openDiff()
    }
    return (
      <div data-component="write-tool">
        <BasicTool
          {...props}
          revision={diff()?.patch || string(props.input.content)}
          icon="code-lines"
          defer
          hasDetails
          hideDetails={props.hideDetails || unchanged()}
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={busy(props.status)} />
                  </span>
                  <ToolFileMeta
                    path={path()}
                    directory={props.directory}
                    changes={diff() ?? streamed()}
                    fallback={
                      // Some models stream the content before the file path.
                      <Show when={streamed()}>
                        {(changes) => (
                          <div data-slot="message-part-tool-changes">
                            <DiffChanges changes={changes()} />
                          </div>
                        )}
                      </Show>
                    }
                  />
                </div>
              </div>
              <ToolDiffAction when={canOpenDiff()} onClick={handleOpenDiffClick} />
            </div>
          }
        >
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              directory={props.directory}
              actions={<Show when={diff()}>{(file) => <DiffChanges changes={file()} />}</Show>}
            >
              <div data-component="write-content">
                <Show
                  when={view()}
                  fallback={
                    <Dynamic
                      component={component}
                      mode="text"
                      file={{
                        name: path(),
                        contents: string(props.input.content),
                        cacheKey: checksum(string(props.input.content)),
                      }}
                      overflow="scroll"
                    />
                  }
                >
                  {(diff) => (
                    <Dynamic component={component} mode="diff" hunkSeparators="simple" fileDiff={diff().fileDiff} />
                  )}
                </Show>
              </div>
            </ToolFileAccordion>
          </Show>
        </BasicTool>
      </div>
    )
  },
})

// Cheap `@@` marker check: keeps the open-diff action hidden for payloads that
// are not a unified diff, without parsing every file while the tool is collapsed.
const HUNK_MARKER = /^\s*@@/m

ToolRegistry.register({
  name: "patch",
  render(props) {
    const i18n = useI18n()
    const component = useFileComponent()
    const list = createMemo(() => fileDiffs(props.metadata.files))
    const single = () => (list().length === 1 ? list()[0] : undefined)
    const [expanded, setExpanded] = createSignal<string[]>([])
    const [seeded, setSeeded] = createSignal(false)
    const [invalid, setInvalid] = createSignal<string[]>([])
    createEffect(() => {
      if (seeded() || !list().length) return
      setExpanded(
        list()
          .filter((file) => file.status !== "deleted")
          .map((file) => file.file),
      )
      setSeeded(true)
    })
    // A search hit inside a collapsed file row must be visible without opening
    // every row by hand, so a forced open expands all of them.
    createEffect(() => {
      if (!props.forceOpen) return
      setExpanded(list().map((file) => file.file))
    })
    const view = (file: FileDiffInfo) => {
      if (!file.patch) return
      const value = normalize(file)
      return value.fileDiff.hunks.length ? value : undefined
    }
    const openDiff = (file: FileDiffInfo) => {
      const diff = view(file)
      if (!diff || !props.actions?.openDiff) return
      props.actions.openDiff({
        file: file.file,
        patch: diff.patch,
        additions: file.additions,
        deletions: file.deletions,
      })
    }
    // A multi-file patch opens every changed file in one diff view. Files that
    // cannot be parsed are skipped, as the per-file action does for them.
    const safeView = (file: FileDiffInfo) => {
      try {
        return view(file)
      } catch {
        return undefined
      }
    }
    const openAllDiffs = (event: MouseEvent) => {
      event.stopPropagation()
      const skipped: string[] = []
      const diffs = list().flatMap((file) => {
        const diff = safeView(file)
        if (!diff) {
          skipped.push(file.file)
          return []
        }
        return [
          {
            file: file.file,
            patch: diff.patch,
            additions: file.additions,
            deletions: file.deletions,
          },
        ]
      })
      setInvalid(skipped)
      if (diffs.length) props.actions?.openDiffs?.(diffs)
    }
    const canOpenAll = () =>
      list().length > 1 && !!props.actions?.openDiffs && list().some((file) => HUNK_MARKER.test(file.patch))
    // The action sits in the file body, not in the row header: the header is a
    // button, and an interactive control inside it is invalid for assistive tech.
    const diffAction = (file: FileDiffInfo) => (
      <Show when={props.actions?.openDiff && HUNK_MARKER.test(file.patch)}>
        <div data-slot="apply-patch-open-diff">
          <Tooltip value={i18n.t("ui.messagePart.openInDiffViewer")} placement="top" gutter={4}>
            <IconButton
              icon="square-arrow-top-right"
              size="small"
              variant="ghost"
              onClick={() => openDiff(file)}
              aria-label={i18n.t("ui.messagePart.openInDiffViewer")}
            />
          </Tooltip>
        </div>
      </Show>
    )
    const changes = (file: FileDiffInfo) => (
      <Switch>
        <Match when={file.status === "added"}>
          <span data-slot="apply-patch-change" data-type="added">
            {i18n.t("ui.patch.action.created")}
          </span>
        </Match>
        <Match when={file.status === "deleted"}>
          <span data-slot="apply-patch-change" data-type="removed">
            {i18n.t("ui.patch.action.deleted")}
          </span>
        </Match>
        <Match when={file.moved}>
          <span data-slot="apply-patch-change" data-type="modified">
            {i18n.t("ui.patch.action.moved")}
          </span>
        </Match>
        <Match when={true}>
          <DiffChanges changes={file} />
        </Match>
      </Switch>
    )
    return (
      <div data-component="apply-patch-tool">
        <BasicTool
          {...props}
          revision={string(props.input.patchText)}
          icon="code-lines"
          defer
          hasDetails
          trigger={
            <div data-component={single() ? "edit-trigger" : "write-trigger"}>
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.tool.patch")} active={busy(props.status)} />
                  </span>
                  <Show when={single()}>
                    {(file) => <ToolFileMeta path={file().file} directory={props.directory} changes={file()} />}
                  </Show>
                  <Show when={!single() && list().length}>
                    <span data-slot="basic-tool-tool-subtitle">
                      {list().length} {i18n.t(list().length > 1 ? "ui.common.file.other" : "ui.common.file.one")}
                    </span>
                    <div data-slot="message-part-tool-changes">
                      <DiffChanges changes={list()} />
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          }
        >
          <Show
            when={single()}
            fallback={
              <Show when={list().length} fallback={<Output text={string(props.input.patchText)} />}>
                <Show when={canOpenAll()}>
                  <div data-slot="apply-patch-open-all">
                    <ToolDiffAction when={true} onClick={openAllDiffs} />
                  </div>
                </Show>
                <Show when={invalid().length}>
                  <div data-slot="apply-patch-open-all-invalid">
                    {i18n.t(invalid().length === 1 ? "ui.patch.openAll.invalid" : "ui.patch.openAll.invalid.other", {
                      count: invalid().length,
                    })}
                    : {invalid().join(", ")}
                  </div>
                </Show>
                <Accordion
                  multiple
                  data-scope="apply-patch"
                  style={{ "--sticky-accordion-offset": "37px" }}
                  value={expanded()}
                  onChange={(value) => setExpanded(Array.isArray(value) ? value : value ? [value] : [])}
                >
                  <For each={list()}>
                    {(file) => (
                      <Accordion.Item
                        value={file.file}
                        data-type={
                          file.status === "deleted"
                            ? "delete"
                            : file.status === "added"
                              ? "add"
                              : file.moved
                                ? "move"
                                : "update"
                        }
                      >
                        <StickyAccordionHeader>
                          <Accordion.Trigger>
                            <div data-slot="apply-patch-trigger-content">
                              <div data-slot="apply-patch-file-info">
                                <FileIcon node={{ path: file.file, type: "file" }} />
                                <div data-slot="apply-patch-file-name-container">
                                  <Show when={file.file.includes("/")}>
                                    <span data-slot="apply-patch-directory">
                                      {`\u2066${relativizeProjectPath(getDirectory(file.file), props.directory)}\u2069`}
                                    </span>
                                  </Show>
                                  <span data-slot="apply-patch-filename">{getFilename(file.file)}</span>
                                </div>
                              </div>
                              <div data-slot="apply-patch-trigger-actions">
                                {changes(file)}
                                <Icon name="chevron-grabber-vertical" size="small" />
                              </div>
                            </div>
                          </Accordion.Trigger>
                        </StickyAccordionHeader>
                        <Accordion.Content>
                          <Show when={expanded().includes(file.file) && view(file)}>
                            {(diff) => (
                              <div data-component="apply-patch-file-diff">
                                {diffAction(file)}
                                <Dynamic
                                  component={component}
                                  mode="diff"
                                  hunkSeparators="simple"
                                  fileDiff={diff().fileDiff}
                                />
                              </div>
                            )}
                          </Show>
                        </Accordion.Content>
                      </Accordion.Item>
                    )}
                  </For>
                </Accordion>
              </Show>
            }
          >
            {(file) => (
              <ToolFileAccordion path={file().file} directory={props.directory} actions={changes(file())}>
                <Show when={view(file())}>
                  {(diff) => (
                    <div data-component="apply-patch-file-diff">
                      {diffAction(file())}
                      <Dynamic component={component} mode="diff" hunkSeparators="simple" fileDiff={diff().fileDiff} />
                    </div>
                  )}
                </Show>
              </ToolFileAccordion>
            )}
          </Show>
        </BasicTool>
      </div>
    )
  },
})

type TodoItem = { content?: unknown; status?: unknown; changed?: unknown; done?: unknown; started?: unknown }

type TodoView = {
  mode?: "full" | "compact"
  todos?: TodoItem[]
  hiddenBefore?: number
  hiddenAfter?: number
}

function isTodoView(value: unknown): value is TodoView {
  if (!value || typeof value !== "object") return false
  return Array.isArray((value as TodoView).todos)
}

function hiddenTodos(i18n: UiI18n, direction: "earlier" | "later", count: number) {
  const key =
    direction === "earlier"
      ? count === 1
        ? "ui.tool.todos.hiddenEarlier"
        : "ui.tool.todos.hiddenEarlier.other"
      : count === 1
        ? "ui.tool.todos.hiddenLater"
        : "ui.tool.todos.hiddenLater.other"
  return i18n.t(key, { count })
}

function TodoCheckbox(props: { checked: boolean; done?: boolean; started?: boolean; children: JSX.Element }) {
  const id = createUniqueId()
  const state = () => (props.checked ? "" : undefined)
  return (
    <div
      role="group"
      data-component="checkbox"
      data-readonly=""
      data-checked={state()}
      data-done={props.done ? "" : undefined}
      data-started={props.started ? "" : undefined}
    >
      <input
        type="checkbox"
        id={`${id}-input`}
        data-slot="checkbox-checkbox-input"
        data-readonly=""
        data-checked={state()}
        checked={props.checked}
        readOnly
        aria-readonly="true"
        aria-labelledby={`${id}-label`}
        onChange={(event) => {
          event.currentTarget.checked = props.checked
        }}
      />
      <div data-slot="checkbox-checkbox-control" data-readonly="" data-checked={state()}>
        <Show when={props.checked}>
          <div data-slot="checkbox-checkbox-indicator" data-readonly="" data-checked="">
            <svg viewBox="0 0 12 12" fill="none" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M3 7.17905L5.02703 8.85135L9 3.5"
                pathLength="1"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="square"
              />
            </svg>
          </div>
        </Show>
      </div>
      <div data-slot="checkbox-checkbox-content">
        <label
          id={`${id}-label`}
          for={`${id}-input`}
          data-slot="checkbox-checkbox-label"
          data-readonly=""
          data-checked={state()}
        >
          {props.children}
        </label>
      </div>
    </div>
  )
}

ToolRegistry.register({
  name: "todowrite",
  render(props) {
    const i18n = useI18n()
    const view = () => (isTodoView(props.metadata.view) ? props.metadata.view : undefined)
    const todos = () => records(props.metadata.todos ?? props.input.todos) as TodoItem[]
    const shown = () => view()?.todos ?? todos()
    return (
      <BasicTool
        {...props}
        defaultOpen
        approvalPlacement="hidden"
        icon="checklist"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.todos")}
            pending={busy(props.status)}
            subtitle={
              todos().length ? `${todos().filter((todo) => todo.status === "completed").length}/${todos().length}` : ""
            }
          />
        }
      >
        <Show when={shown().length}>
          <div data-component="todos">
            <Show when={view()?.mode === "compact" && (view()?.hiddenBefore ?? 0) > 0}>
              <div data-slot="message-part-todo-hidden">{hiddenTodos(i18n, "earlier", view()?.hiddenBefore ?? 0)}</div>
            </Show>
            <For each={shown()}>
              {(todo) => (
                <TodoCheckbox
                  checked={todo.status === "completed"}
                  done={todo.done === true}
                  started={todo.started === true}
                >
                  <span
                    data-slot="message-part-todo-content"
                    data-completed={todo.status === "completed" ? "completed" : undefined}
                    data-changed={todo.changed === true ? "changed" : undefined}
                  >
                    {string(todo.content)}
                  </span>
                </TodoCheckbox>
              )}
            </For>
            <Show when={view()?.mode === "compact" && (view()?.hiddenAfter ?? 0) > 0}>
              <div data-slot="message-part-todo-hidden">{hiddenTodos(i18n, "later", view()?.hiddenAfter ?? 0)}</div>
            </Show>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()
    const questions = () => records(props.input.questions)
    const answers = () => (Array.isArray(props.metadata.answers) ? props.metadata.answers : [])
    const dismissed = () => props.status === "error"
    const completed = () => props.status === "completed"
    const subtitle = () => {
      const count = questions().length
      if (!count) return ""
      if (dismissed()) return i18n.t("ui.question.subtitle.dismissed", { count })
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
    }
    return (
      <BasicTool
        {...props}
        defaultOpen={completed() && !dismissed()}
        icon="bubble-5"
        trigger={
          <ToolTriggerRow title={i18n.t("ui.tool.questions")} pending={busy(props.status)} subtitle={subtitle()} />
        }
      >
        <Show when={completed() || dismissed()}>
          <div data-component="question-answers" data-dismissed={dismissed() ? "" : undefined}>
            <For each={questions()}>
              {(question, index) => {
                const answer = () => answers()[index()]
                const text = () => {
                  if (dismissed()) return i18n.t("ui.question.answer.dismissed")
                  const value = answer()
                  return (Array.isArray(value) ? value.map(string).join(", ") : "") || i18n.t("ui.question.answer.none")
                }
                return (
                  <div data-slot="question-answer-item">
                    <div data-slot="question-text">{string(question.question)}</div>
                    <div data-slot="answer-text">{text()}</div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "skill",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        hideDetails
        icon="brain"
        trigger={
          <ToolTriggerRow
            title={i18n.t("ui.tool.skill")}
            pending={busy(props.status)}
            subtitle={string(props.metadata.name) || string(props.input.id)}
          />
        }
        animated
      />
    )
  },
})

ToolRegistry.register({
  name: "execute",
  render: ExecuteTool,
})

ToolRegistry.register({
  name: "chart",
  render: ChartTool,
})

ToolRegistry.register({
  name: "experimental_image_generate",
  render: ImageTool,
})

ToolRegistry.register({
  name: "plan_exit",
  render: PlanTool,
})

export function UserMessageDisplay(props: { message: SessionMessageUser; copyLabel?: string }) {
  const i18n = useI18n()
  const clipboard = useClipboard()
  const dialog = useDialog()
  const [copied, setCopied] = createSignal(false)
  const files = () => props.message.files ?? []
  const stamp = () =>
    new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }).format(new Date(props.message.time.created))
  const copy = async () => {
    await clipboard.write(props.message.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div data-component="user-message">
      <Show when={files().length}>
        <div data-slot="user-message-attachments">
          <For each={files()}>
            {(file) => (
              <div
                data-slot="user-message-attachment"
                data-type={file.mime.startsWith("image/") ? "image" : "file"}
                onClick={() => {
                  const uri = attachmentUri(file)
                  if (file.mime.startsWith("image/") && uri)
                    return dialog.show(() => <ImagePreview src={uri} alt={file.name} />)
                }}
              >
                <Show
                  when={file.mime.startsWith("image/") && attachmentUri(file)}
                  fallback={
                    <div data-slot="user-message-attachment-file" title={file.description ?? file.name}>
                      <FileIcon node={{ path: file.name ?? "", type: "file" }} />
                      <span data-slot="user-message-attachment-name">
                        {file.name ?? i18n.t("ui.message.attachment.alt")}
                      </span>
                    </div>
                  }
                >
                  {(uri) => (
                    <img
                      data-slot="user-message-attachment-image"
                      src={uri()}
                      alt={file.name ?? i18n.t("ui.message.attachment.alt")}
                    />
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.message.text}>
        <div data-slot="user-message-body">
          <Show when={props.message.text}>
            <div data-slot="user-message-text" dir="auto">
              {props.message.text}
            </div>
          </Show>
        </div>
        <div data-slot="user-message-copy-wrapper">
          <span data-slot="user-message-meta-wrap">
            <span data-slot="user-message-meta-tail" class="text-12-regular text-text-weak cursor-default">
              {stamp()}
            </span>
          </span>
          <Tooltip
            value={copied() ? i18n.t("ui.message.copied") : (props.copyLabel ?? i18n.t("ui.message.copyMessage"))}
            placement="right"
            gutter={4}
          >
            <IconButton
              icon={copied() ? "check" : "copy"}
              size="normal"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={copy}
              aria-label={
                copied() ? i18n.t("ui.message.copied") : (props.copyLabel ?? i18n.t("ui.message.copyMessage"))
              }
            />
          </Tooltip>
        </div>
      </Show>
    </div>
  )
}
