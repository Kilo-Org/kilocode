import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
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
import { parseDiffFromFile } from "@pierre/diffs"
import { useClipboard } from "../context/clipboard"
import { useDialog } from "../context/dialog"
import { useFileComponent } from "../context/file"
import { useI18n } from "../context/i18n"
import { Accordion } from "./accordion"
import { AgentAvatar, taskStatus } from "./agent-avatar"
import { BasicTool } from "./basic-tool"
import { Card } from "./card"
import { attachmentUri, fileDiffs, relativizeProjectPath, toolOutput } from "./content-data"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { ImagePreview } from "./image-preview"
import { Markdown } from "./markdown"
import { ReasoningContent } from "./reasoning-content"
import { normalize } from "./session-diff"
import { ShellOutput } from "./shell-output"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { TextShimmer } from "./text-shimmer"
import { ToolApprovalProvider, resolveToolApproval } from "./tool-approval"
import { readToolOpen, toolOpenKey } from "./tool-open-state"
import { busy, createThrottledValue, STREAMING_TEXT_RENDER_THROTTLE_MS, TEXT_RENDER_THROTTLE_MS } from "./tool-utils"
import { Tooltip } from "./tooltip"

export { ToolApprovalProvider, resolveToolApproval, ToolApprovalVisibilityProvider } from "./tool-approval"
export { useGrowIn } from "./tool-utils"
export type { ReasoningDisplay } from "./reasoning-open"
export { relativizeProjectPath } from "./content-data"

export type ContentPartProps = {
  item: SessionMessageAssistant["content"][number]
  message: SessionMessageAssistant
  index: number
  directory?: string
  open?: (uri: string) => void
  copy?: boolean
  settled?: boolean
  defaultOpen?: boolean
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
          <ToolContent item={item()} directory={props.directory} open={props.open} defaultOpen={props.defaultOpen} />
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
        <Show when={props.copy}>
          <div data-slot="assistant-copy-wrapper">
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

function ToolContent(props: {
  item: SessionMessageAssistantTool
  directory?: string
  open?: (uri: string) => void
  defaultOpen?: boolean
}) {
  const i18n = useI18n()
  const state = () => props.item.state
  const metadata = (): Record<string, unknown> => {
    const value = state()
    return "metadata" in value ? (value.metadata ?? {}) : {}
  }
  const input = (): Record<string, unknown> => {
    const value = state()
    return value.status === "streaming" ? {} : value.input
  }
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
              />
            </ToolApprovalProvider>
          }
        >
          <Card variant="error">
            <div data-component="tool-error">
              <Icon name="circle-ban-sign" size="small" />
              <div data-slot="message-part-tool-error-content">
                <div data-slot="message-part-tool-error-heading">
                  <div data-slot="message-part-tool-error-title">{error()?.type}</div>
                  <Show when={error()?.status}>
                    {(code) => <span data-slot="message-part-tool-error-code">{code()}</span>}
                  </Show>
                </div>
                <span data-slot="message-part-tool-error-message">{error()?.message}</span>
              </div>
            </div>
          </Card>
        </Show>
      </div>
    </Show>
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

function McpTool(props: ToolProps) {
  const i18n = useI18n()
  const keys = ["description", "query", "url", "path", "pattern", "id"]
  const subtitle = () => keys.map((key) => string(props.input[key])).find(Boolean)
  const input = () =>
    Object.keys(props.input).length ? "```json\n" + JSON.stringify(props.input, null, 2) + "\n```" : ""
  return (
    <BasicTool {...props} icon="mcp" trigger={{ title: props.tool, subtitle: subtitle() }}>
      <Show when={input()}>
        <div data-slot="mcp-section-label">{i18n.t("ui.messagePart.mcp.input")}</div>
        <Output text={input()} />
      </Show>
      <Show when={props.output}>
        <Show when={input()}>
          <div data-slot="mcp-tool-divider" />
        </Show>
        <div data-slot="mcp-section-label">{i18n.t("ui.messagePart.mcp.output")}</div>
        <Output text={props.output} />
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
    const images = () => props.attachments.filter((file) => file.mime.startsWith("image/"))
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
            />
          }
        />
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

ToolRegistry.register({
  name: "subagent",
  render(props) {
    const i18n = useI18n()
    const agent = () => string(props.input.agent)
    const title = () =>
      agent()
        ? i18n.t("ui.tool.agent", { type: agent()[0]!.toUpperCase() + agent().slice(1) })
        : i18n.t("ui.tool.agent.default")
    return (
      <BasicTool
        {...props}
        hideDetails
        icon="task"
        iconNode={<AgentAvatar id={props.partID} status={taskStatus(props.status)} />}
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={title()} active={busy(props.status)} />
              </span>
              <Show when={string(props.input.description)}>
                {(description) => <span data-slot="basic-tool-tool-subtitle">{description()}</span>}
              </Show>
            </div>
          </div>
        }
        animated
      />
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
                      {relativizeProjectPath(getDirectory(props.path), props.directory)}
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

function ToolFileMeta(props: { path: string; directory?: string; changes?: FileDiffInfo }) {
  return (
    <Show when={props.path}>
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

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const component = useFileComponent()
    const diff = () => fileDiffs(props.metadata.files)[0]
    const path = () => diff()?.file || string(props.input.path)
    const view = () => {
      const file = diff()
      if (file) return normalize(file).fileDiff
      const before = string(props.input.oldString)
      const after = string(props.input.newString)
      if (!before && !after) return
      return parseDiffFromFile({ name: path(), contents: before }, { name: path(), contents: after })
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
                  <ToolFileMeta path={path()} directory={props.directory} changes={diff()} />
                </div>
              </div>
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
                  {(fileDiff) => (
                    <Dynamic component={component} mode="diff" hunkSeparators="simple" fileDiff={fileDiff()} />
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
    const view = () => {
      const file = diff()
      return file ? normalize(file) : undefined
    }
    return (
      <div data-component="write-tool">
        <BasicTool
          {...props}
          revision={diff()?.patch ?? string(props.input.content)}
          icon="code-lines"
          defer
          hasDetails
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={busy(props.status)} />
                  </span>
                  <ToolFileMeta path={path()} directory={props.directory} changes={diff()} />
                </div>
              </div>
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

ToolRegistry.register({
  name: "patch",
  render(props) {
    const i18n = useI18n()
    const component = useFileComponent()
    const list = createMemo(() => fileDiffs(props.metadata.files))
    const single = () => (list().length === 1 ? list()[0] : undefined)
    const [expanded, setExpanded] = createSignal<string[]>([])
    const [seeded, setSeeded] = createSignal(false)
    createEffect(() => {
      if (seeded() || !list().length) return
      setExpanded(
        list()
          .filter((file) => file.status !== "deleted")
          .map((file) => file.file),
      )
      setSeeded(true)
    })
    const view = (file: FileDiffInfo) => {
      if (!file.patch) return
      const value = normalize(file)
      return value.fileDiff.hunks.length ? value : undefined
    }
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
                        data-type={file.status === "deleted" ? "delete" : file.status === "added" ? "add" : "update"}
                      >
                        <StickyAccordionHeader>
                          <Accordion.Trigger>
                            <div data-slot="apply-patch-trigger-content">
                              <div data-slot="apply-patch-file-info">
                                <FileIcon node={{ path: file.file, type: "file" }} />
                                <div data-slot="apply-patch-file-name-container">
                                  <Show when={file.file.includes("/")}>
                                    <span data-slot="apply-patch-directory">
                                      {relativizeProjectPath(getDirectory(file.file), props.directory)}
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

function TodoCheckbox(props: { checked: boolean; children: JSX.Element }) {
  const id = createUniqueId()
  const state = () => (props.checked ? "" : undefined)
  return (
    <div role="group" data-component="checkbox" data-readonly="" data-checked={state()}>
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
    const todos = () => records(props.metadata.todos ?? props.input.todos)
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
        <Show when={todos().length}>
          <div data-component="todos">
            <For each={todos()}>
              {(todo) => (
                <TodoCheckbox checked={todo.status === "completed"}>
                  <span
                    data-slot="message-part-todo-content"
                    data-completed={todo.status === "completed" ? "completed" : undefined}
                  >
                    {string(todo.content)}
                  </span>
                </TodoCheckbox>
              )}
            </For>
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
            subtitle={string(props.input.id)}
          />
        }
        animated
      />
    )
  },
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
