// kilocode_change - new file
export * from "@opencode-ai/ui/message-part"

import {
  createMemo,
  createSignal,
  For,
  Show,
  onCleanup,
  createEffect,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { TextPart, ToolPart } from "@kilocode/sdk/v2"
import { ToolRegistry, PART_MAPPING } from "@opencode-ai/ui/message-part"
import { BasicTool } from "@opencode-ai/ui/basic-tool"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { useData } from "@opencode-ai/ui/context/data"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { useDiffComponent } from "@opencode-ai/ui/context/diff"
import { useCodeComponent } from "@opencode-ai/ui/context/code"
import { getDirectory as _getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import type { OpenFileFn } from "@opencode-ai/ui/context/data"

function relativizeProjectPaths(text: string, directory?: string) {
  if (!text) return ""
  if (!directory) return text
  return text.split(directory).join("")
}

function getDirectory(path: string | undefined) {
  const data = useData()
  return relativizeProjectPaths(_getDirectory(path), data.directory)
}

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
}

function getDiagnostics(
  diagnosticsByFile: Record<string, Diagnostic[]> | undefined,
  filePath: string | undefined,
): Diagnostic[] {
  if (!diagnosticsByFile || !filePath) return []
  const diagnostics = diagnosticsByFile[filePath] ?? []
  return diagnostics.filter((d) => d.severity === 1).slice(0, 3)
}

function DiagnosticsDisplay(props: { diagnostics: Diagnostic[] }) {
  const i18n = useI18n()
  return (
    <Show when={props.diagnostics.length > 0}>
      <div data-component="diagnostics">
        <For each={props.diagnostics}>
          {(diagnostic) => (
            <div data-slot="diagnostic">
              <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
              <span data-slot="diagnostic-location">
                [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
              </span>
              <span data-slot="diagnostic-message">{diagnostic.message}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

/** Check if text looks like a file path (contains / and has a file extension) */
const FILE_PATH_RE = /^\.{0,2}\/.*\.\w+$|^[a-zA-Z]:\\.*\.\w+$|^\w[\w.-]*\/.*\.\w+$/

function isFilePath(text: string): boolean {
  return FILE_PATH_RE.test(text.trim())
}

/**
 * Renders tool output text with file paths as clickable elements.
 * Lines that look like file paths become clickable to open the file in the editor.
 */
function ClickableFileOutput(props: { text: string; openFile?: OpenFileFn; directory?: string }) {
  const lines = createMemo(() => props.text.split("\n").filter((l) => l.trim()))
  const hasClickable = () => !!props.openFile

  return (
    <div data-component="clickable-file-output">
      <For each={lines()}>
        {(line) => {
          const trimmed = line.trim()
          const displayPath = props.directory ? relativizeProjectPaths(trimmed, props.directory) : trimmed
          return (
            <Show
              when={hasClickable() && isFilePath(trimmed)}
              fallback={<div data-slot="file-output-line">{displayPath}</div>}
            >
              <div
                data-slot="file-output-line"
                class="clickable"
                onClick={() => props.openFile!(trimmed)}
              >
                {displayPath}
              </div>
            </Show>
          )
        }}
      </For>
    </div>
  )
}

const TEXT_RENDER_THROTTLE_MS = 100

function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      last = now
      setValue(next)
      return
    }
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
}

// Override TextPartDisplay to make inline code file paths clickable
PART_MAPPING["text"] = function TextPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const part = props.part as TextPart
  const displayText = () => relativizeProjectPaths((part.text ?? "").trim(), data.directory)
  const throttledText = createThrottledValue(displayText)
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = displayText()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCodeClick = (e: MouseEvent) => {
    if (!data.openFile) return
    const target = e.target as HTMLElement
    const code = target.closest("code")
    if (!code || code.closest("pre")) return
    const text = code.textContent?.trim()
    if (!text || !isFilePath(text)) return
    e.preventDefault()
    e.stopPropagation()
    data.openFile(text)
  }

  return (
    <Show when={throttledText()}>
      <div data-component="text-part" data-has-open-file={!!data.openFile || undefined}>
        <div data-slot="text-part-body" onClick={handleCodeClick}>
          <Markdown text={throttledText()} cacheKey={part.id} />
          <div data-slot="text-part-copy-wrapper">
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              placement="top"
              gutter={8}
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                size="small"
                variant="secondary"
                onMouseDown={(e: MouseEvent) => e.preventDefault()}
                onClick={handleCopy}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </Show>
  )
}

// Override read tool to add clickable subtitle and loaded file paths
ToolRegistry.register({
  name: "read",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const args: string[] = []
    if (props.input.offset) args.push("offset=" + props.input.offset)
    if (props.input.limit) args.push("limit=" + props.input.limit)
    const loaded = createMemo(() => {
      if (props.status !== "completed") return []
      const value = props.metadata.loaded
      if (!value || !Array.isArray(value)) return []
      return value.filter((p): p is string => typeof p === "string")
    })
    const openFile = () => {
      if (props.input.filePath && data.openFile) data.openFile(props.input.filePath)
    }
    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          trigger={{
            title: i18n.t("ui.tool.read"),
            subtitle: props.input.filePath ? getFilename(props.input.filePath) : "",
            args,
          }}
          onSubtitleClick={props.input.filePath ? openFile : undefined}
        />
        <For each={loaded()}>
          {(filepath) => (
            <div data-component="tool-loaded-file">
              <Icon name="enter" size="small" />
              <span
                classList={{ clickable: !!data.openFile }}
                onClick={(e) => {
                  if (data.openFile) {
                    e.stopPropagation()
                    data.openFile(filepath)
                  }
                }}
              >
                {i18n.t("ui.tool.loaded")} {relativizeProjectPaths(filepath, data.directory)}
              </span>
            </div>
          )}
        </For>
      </>
    )
  },
})

// Override list tool to use clickable file output
ToolRegistry.register({
  name: "list",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="bullet-list"
        trigger={{ title: i18n.t("ui.tool.list"), subtitle: getDirectory(props.input.path || "/") }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <ClickableFileOutput text={output()} openFile={data.openFile} directory={data.directory} />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

// Override glob tool to use clickable file output
ToolRegistry.register({
  name: "glob",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.glob"),
          subtitle: getDirectory(props.input.path || "/"),
          args: props.input.pattern ? ["pattern=" + props.input.pattern] : [],
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <ClickableFileOutput text={output()} openFile={data.openFile} directory={data.directory} />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

// Override grep tool to use clickable file output
ToolRegistry.register({
  name: "grep",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const args: string[] = []
    if (props.input.pattern) args.push("pattern=" + props.input.pattern)
    if (props.input.include) args.push("include=" + props.input.include)
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: getDirectory(props.input.path || "/"),
          args,
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <ClickableFileOutput text={output()} openFile={data.openFile} directory={data.directory} />
            </div>
          )}
        </Show>
      </BasicTool>
    )
  },
})

// Override edit tool to add clickable filename
ToolRegistry.register({
  name: "edit",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const diffComponent = useDiffComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const filename = () => getFilename(props.input.filePath ?? "")
    const openFile = (e: MouseEvent) => {
      e.stopPropagation()
      if (props.input.filePath && data.openFile) data.openFile(props.input.filePath)
    }
    return (
      <BasicTool
        {...props}
        icon="code-lines"
        trigger={
          <div data-component="edit-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">{i18n.t("ui.messagePart.title.edit")}</span>
                <span
                  data-slot="message-part-title-filename"
                  classList={{ clickable: !!data.openFile && !!props.input.filePath }}
                  onClick={data.openFile && props.input.filePath ? openFile : undefined}
                >
                  {filename()}
                </span>
              </div>
              <Show when={props.input.filePath?.includes("/")}>
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </div>
              </Show>
            </div>
            <div data-slot="message-part-actions">
              <Show when={props.metadata.filediff}>
                <DiffChanges changes={props.metadata.filediff} />
              </Show>
            </div>
          </div>
        }
      >
        <Show when={props.metadata.filediff?.path || props.input.filePath}>
          <div data-component="edit-content">
            <Dynamic
              component={diffComponent}
              before={{
                name: props.metadata?.filediff?.file || props.input.filePath,
                contents: props.metadata?.filediff?.before || props.input.oldString,
              }}
              after={{
                name: props.metadata?.filediff?.file || props.input.filePath,
                contents: props.metadata?.filediff?.after || props.input.newString,
              }}
            />
          </div>
        </Show>
        <DiagnosticsDisplay diagnostics={diagnostics()} />
      </BasicTool>
    )
  },
})

// Override write tool to add clickable filename
ToolRegistry.register({
  name: "write",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const codeComponent = useCodeComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const filename = () => getFilename(props.input.filePath ?? "")
    const openFile = (e: MouseEvent) => {
      e.stopPropagation()
      if (props.input.filePath && data.openFile) data.openFile(props.input.filePath)
    }
    return (
      <BasicTool
        {...props}
        icon="code-lines"
        trigger={
          <div data-component="write-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">{i18n.t("ui.messagePart.title.write")}</span>
                <span
                  data-slot="message-part-title-filename"
                  classList={{ clickable: !!data.openFile && !!props.input.filePath }}
                  onClick={data.openFile && props.input.filePath ? openFile : undefined}
                >
                  {filename()}
                </span>
              </div>
              <Show when={props.input.filePath?.includes("/")}>
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </div>
              </Show>
            </div>
            <div data-slot="message-part-actions">{/* placeholder */}</div>
          </div>
        }
      >
        <Show when={props.input.content}>
          <div data-component="write-content">
            <Dynamic
              component={codeComponent}
              file={{
                name: props.input.filePath,
                contents: props.input.content,
                cacheKey: checksum(props.input.content),
              }}
              overflow="scroll"
            />
          </div>
        </Show>
        <DiagnosticsDisplay diagnostics={diagnostics()} />
      </BasicTool>
    )
  },
})
