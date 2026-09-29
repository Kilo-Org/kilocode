import { Dynamic } from "solid-js/web"
import { Component, Show, Accessor, createMemo, createSignal, createEffect, onCleanup, on } from "solid-js"
import { MarkdownPane } from "../diff-viewer/MarkdownDiffView"
import { isMarkdownPath, type DocumentData, type DocumentTab } from "./state"
import { InspectorTabStrip } from "../agent-manager/InspectorTabStrip"
import { SortableClosableTab } from "../agent-manager/ClosableTab"
import { useCodeComponent } from "@kilocode/kilo-ui/context/code"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import type { DiffLineAnnotation, AnnotationSide, SelectedLineRange } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import type { ReviewComment } from "../diff-viewer/review-comments"
import {
  buildFileAnnotations,
  buildReviewAnnotation,
  createReviewComposer,
  sendReviewComments,
  labels,
  type AnnotationMeta,
  type ReviewComposer,
  type ReviewDraft,
} from "../diff-viewer/review-annotations"
import { getFilename, lineCount } from "../diff-viewer/review-comments"
import { useLanguage } from "../src/context/language"

export interface DocumentPanelProps {
  tabs: Accessor<DocumentTab[]>
  active: Accessor<string | undefined>
  getData: (file: string) => DocumentData | undefined
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onReorder: (from: string, to: string) => void
  onOpenFile: (file: string, line?: number, column?: number) => void
  onCopyPath: (file: string) => void
  onClosePanel: () => void
  onSendAll?: () => void
  activeTerminalId?: string
  visible: Accessor<boolean>
}

function virtualDiff(file: string, content: string): WorktreeFileDiff {
  return {
    file,
    before: "",
    after: content,
    additions: lineCount(content),
    deletions: 0,
    status: "added",
  }
}

function sendAllKeybind(t: (key: string) => string): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? t("agentManager.review.sendAllShortcut.mac")
    : t("agentManager.review.sendAllShortcut.other")
}

function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {})
}

function copyDocumentContent(
  text: string,
  timer: { id?: ReturnType<typeof setTimeout> },
  setCopied: (value: boolean) => void,
): void {
  clearTimeout(timer.id)
  navigator.clipboard
    ?.writeText(text)
    .then(() => {
      setCopied(true)
      timer.id = setTimeout(() => setCopied(false), 1500)
    })
    .catch(() => setCopied(false))
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}

function handleSendAllKeyDown(event: KeyboardEvent, comments: ReviewComment[], send: () => void): void {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return
  if (isEditableTarget(event.target)) return
  if (comments.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  send()
}

// Cmd/Ctrl+A inside the panel otherwise selects the whole webview DOM
// (header title, tab labels, action icons). Scope it to the rendered
// document content so users get just the file's text, matching what
// the Copy Content action copies.
function handleSelectAllKeyDown(event: KeyboardEvent, content: HTMLElement | undefined): void {
  if (event.key.toLowerCase() !== "a" || (!event.metaKey && !event.ctrlKey)) return
  if (isEditableTarget(event.target) || !content) return
  event.preventDefault()
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(content)
  selection.removeAllRanges()
  selection.addRange(range)
}

export const DocumentPanel: Component<DocumentPanelProps> = (props) => {
  const { t } = useLanguage()
  const code = useCodeComponent()
  const [source, setSource] = createSignal(false)
  const [draft, setDraft] = createSignal<ReviewDraft | null>(null)
  const [editing, setEditing] = createSignal<string | null>(null)
  const composer: ReviewComposer = createReviewComposer()
  let draftMeta: AnnotationMeta | null = null
  let editMeta: AnnotationMeta | null = null
  let nextId = 0
  let rootRef: HTMLElement | undefined
  let contentRef: HTMLDivElement | undefined

  const selected = createMemo(() => {
    const id = props.active()
    return props.tabs().find((tab) => tab.id === id)
  })
  const data = () => {
    const tab = selected()
    return tab ? props.getData(tab.file) : undefined
  }
  const isImage = () => data()?.kind === "image"
  const canCopy = () => !isImage() && !data()?.loading && !data()?.error
  const file = () => selected()?.file ?? ""
  const content = () => data()?.content ?? ""
  const diff = () => virtualDiff(file(), content())

  const [copied, setCopied] = createSignal(false)
  const copyTimer: { id?: ReturnType<typeof setTimeout> } = {}
  onCleanup(() => clearTimeout(copyTimer.id))
  const copy = () => copyDocumentContent(content(), copyTimer, setCopied)

  const updateComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const comments = () => props.comments.filter((item) => item.file === file())
  const focusRoot = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => rootRef?.focus())
    })
  }
  const addComment = (path: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    updateComments([
      ...props.comments,
      { id: `doc-${++nextId}-${Date.now()}`, file: path, side, line, comment: text, selectedText },
    ])
    setDraft(null)
    draftMeta = null
    composer.draft = null
    focusRoot()
  }
  const sendComment = (path: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    sendReviewComments(
      [{ id: `doc-${++nextId}-${Date.now()}`, file: path, side, line, comment: text, selectedText }],
      props.activeTerminalId,
    )
    setDraft(null)
    draftMeta = null
    composer.draft = null
    focusRoot()
  }
  const updateComment = (id: string, text: string) => {
    updateComments(props.comments.map((item) => (item.id === id ? { ...item, comment: text } : item)))
    setEditing(null)
    editMeta = null
    composer.edit = null
    focusRoot()
  }
  const deleteComment = (id: string) => {
    updateComments(props.comments.filter((item) => item.id !== id))
    setEditing(null)
    editMeta = null
    composer.edit = null
    focusRoot()
  }
  const cancelDraft = () => {
    setDraft(null)
    draftMeta = null
    composer.draft = null
    focusRoot()
  }
  const annotations = (): DiffLineAnnotation<AnnotationMeta>[] => {
    const result = buildFileAnnotations(file(), comments(), editing(), draft(), draftMeta, editMeta)
    draftMeta = result.draftMeta
    editMeta = result.editMeta
    composer.draft = draft() ? draftMeta : null
    composer.edit = editing() ? editMeta : null
    return result.annotations
  }
  const renderAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>) =>
    buildReviewAnnotation(annotation, {
      diffs: [diff()],
      editing: editing(),
      setEditing: (id) => setEditing(id),
      addComment,
      sendComment,
      updateComment,
      deleteComment,
      cancelDraft,
      labels: labels(t),
      activeTerminalId: () => props.activeTerminalId,
    })
  const gutter = (range: SelectedLineRange) => {
    if (draft()) return
    const side: AnnotationSide = "additions"
    const next = { file: file(), side, line: range.start, endLine: range.end }
    draftMeta = { type: "draft", comment: null, ...next }
    composer.draft = draftMeta
    setDraft(next)
  }
  const sendAll = () => {
    if (props.comments.length === 0) return
    sendReviewComments(props.comments, props.activeTerminalId)
    updateComments([])
    if (props.onSendAll) props.onSendAll()
    else focusRoot()
  }

  createEffect(
    on(
      () => [file(), content(), props.comments, data()?.loading, data()?.error] as const,
      ([path, text, current]) => {
        if (!path) return
        if (data()?.loading || data()?.error || data()?.content === undefined) return
        const max = lineCount(text)
        const valid = current.filter((item) => item.file !== path || (item.line >= 1 && item.line <= max))
        if (valid.length !== current.length) updateComments(valid)
        const currentDraft = draft()
        if (currentDraft && currentDraft.file === path && currentDraft.line > max) cancelDraft()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => [file(), props.tabs()] as const,
      () => {
        setDraft(null)
        setEditing(null)
        draftMeta = null
        editMeta = null
        composer.draft = null
        composer.edit = null
        clearTimeout(copyTimer.id)
        setCopied(false)
      },
      { defer: true },
    ),
  )

  const close = (id: string, focus: { restore: () => void }) => {
    props.onClose(id)
    if (props.tabs().length > 0) focus.restore()
  }

  return (
    <section
      class="am-document-panel"
      classList={{ "am-document-panel-visible": props.visible() }}
      aria-label={t("agentManager.documents.title")}
      aria-hidden={!props.visible()}
      inert={!props.visible()}
      onKeyDown={(event) => {
        handleSendAllKeyDown(event, props.comments, sendAll)
        handleSelectAllKeyDown(event, contentRef)
      }}
      tabIndex={-1}
      ref={rootRef}
    >
      <header class="am-document-header">
        <div class="am-document-heading">
          <Icon name="book-open-check" size="small" />
          <span>{t("agentManager.documents.title")}</span>
          <span class="am-document-count">{props.tabs().length}</span>
        </div>
        <div class="am-document-actions">
          <Show when={selected()}>
            <Tooltip
              value={source() ? t("agentManager.documents.preview") : t("agentManager.documents.source")}
              placement="top"
            >
              <IconButton
                icon={source() ? "eye" : "code"}
                size="small"
                variant="ghost"
                label={source() ? t("agentManager.documents.preview") : t("agentManager.documents.source")}
                onClick={() => setSource((value) => !value)}
              />
            </Tooltip>
            <Tooltip value={t("agentManager.diff.openFile")} placement="top">
              <IconButton
                icon="go-to-file"
                size="small"
                variant="ghost"
                label={t("agentManager.diff.openFile")}
                onClick={() => props.onOpenFile(file(), selected()?.line, selected()?.column)}
              />
            </Tooltip>
            <Show when={canCopy()}>
              <Tooltip value={t("agentManager.documents.copy")} placement="top">
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="small"
                  variant="ghost"
                  label={t("agentManager.documents.copy")}
                  onClick={copy}
                />
              </Tooltip>
            </Show>
          </Show>
          <IconButton
            icon="close"
            size="small"
            variant="ghost"
            label={t("common.close")}
            onClick={props.onClosePanel}
          />
        </div>
      </header>
      <InspectorTabStrip
        ids={() => props.tabs().map((tab) => tab.id)}
        active={props.active}
        label={t("agentManager.documents.tabs")}
        overlay={(id) => props.tabs().find((tab) => tab.id === id)?.file ?? ""}
        onSelect={props.onSelect}
        onReorder={props.onReorder}
        drag={(id) => {
          const tab = props.tabs().find((item) => item.id === id)
          return tab ? { kind: "file", path: tab.file } : undefined
        }}
        renderTab={(id, api) => {
          const tab = props.tabs().find((item) => item.id === id)!
          return (
            <SortableClosableTab
              id={id}
              class="am-document-tab"
              label={getFilename(tab.file)}
              tooltip={tab.file}
              icon="open-file"
              iconNode={<FileIcon node={{ path: tab.file, type: "file" }} class="am-document-tab-icon" />}
              showKeybind={false}
              active={props.active() === id}
              role="tab"
              selected={props.active() === id}
              tabIndex={props.active() === id ? 0 : -1}
              onKeyDown={(event) => api.focus.key(id, event)}
              onSelect={() => props.onSelect(id)}
              onMiddleClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                close(id, api.focus)
              }}
              onClose={() => close(id, api.focus)}
              onCloseOthers={() => props.onCloseOthers(id)}
              menuLeading={
                <>
                  <ContextMenu.Item onSelect={() => props.onCopyPath(tab.file)}>
                    <Icon name="copy" size="small" />
                    <ContextMenu.ItemLabel>{t("agentManager.documents.copyPath")}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                  <ContextMenu.Item onSelect={() => copyText(tab.file)}>
                    <Icon name="copy" size="small" />
                    <ContextMenu.ItemLabel>{t("agentManager.documents.copyRelativePath")}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                  <ContextMenu.Item onSelect={() => copyText(getFilename(tab.file))}>
                    <Icon name="copy" size="small" />
                    <ContextMenu.ItemLabel>{t("agentManager.documents.copyFileName")}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                  <ContextMenu.Item onSelect={() => props.onOpenFile(tab.file, tab.line, tab.column)}>
                    <Icon name="go-to-file" size="small" />
                    <ContextMenu.ItemLabel>{t("agentManager.diff.openFile")}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                </>
              }
            />
          )
        }}
      />
      <Show when={selected()} fallback={<div class="am-document-empty">{t("agentManager.documents.empty")}</div>}>
        <Show when={data()?.loading}>
          <div class="am-document-state">{t("agentManager.documents.loading")}</div>
        </Show>
        <Show when={data()?.error}>{(error) => <div class="am-document-state am-document-error">{error()}</div>}</Show>
        <Show when={!data()?.loading && !data()?.error && isImage()}>
          <div class="am-document-image-wrap">
            <img src={`data:${data()?.mime};base64,${data()?.data}`} alt={file()} class="am-document-image" />
          </div>
        </Show>
        <Show when={!data()?.loading && !data()?.error && !isImage()}>
          <div class="am-document-content" ref={contentRef}>
            <Show
              when={!source() && isMarkdownPath(file())}
              fallback={
                <Dynamic component={code} file={{ name: file(), contents: content() }} class="am-document-code" />
              }
            >
              <MarkdownPane
                text={content()}
                side="additions"
                cache={`${file()}:document`}
                annotations={annotations()}
                renderAnnotation={renderAnnotation}
                enableGutterUtility={true}
                onGutterUtilityClick={gutter}
                onLineNumberClick={(event) => props.onOpenFile(file(), event.lineNumber)}
              />
            </Show>
          </div>
        </Show>
      </Show>
      <Show when={props.comments.length > 0}>
        <div class="am-diff-comments-footer">
          <span class="am-diff-comments-count">
            {t("agentManager.documents.comments", { count: props.comments.length })}
          </span>
          <TooltipKeybind title={t("agentManager.review.sendAllToChat")} keybind={sendAllKeybind(t)} placement="top">
            <Button variant="primary" size="small" onClick={sendAll}>
              {t("agentManager.review.sendAllToChat")}
            </Button>
          </TooltipKeybind>
        </div>
      </Show>
    </section>
  )
}
