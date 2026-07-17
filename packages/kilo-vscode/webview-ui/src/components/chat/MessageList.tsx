/** @jsxImportSource solid-js */

/**
 * MessageList component
 * Scrollable turn-based message list with virtualization.
 * Each user message is rendered as a VscodeSessionTurn — a custom component that
 * renders all assistant parts as a flat, verbose list with no context grouping,
 * and fully expands sub-agent (task tool) parts inline.
 * Shows recent sessions in the empty state for quick resumption.
 */

import {
  type Accessor,
  type Component,
  type JSX,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { useProvider } from "../../context/provider"
import { useWorktreeMode } from "../../context/worktree-mode"
import { WelcomeEmptyState } from "./WelcomeEmptyState"
import { TranscriptRowView } from "./TranscriptRow"
import type { ErrorDisplayProps } from "./ErrorDisplay"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { TurnOutcome } from "../shared/TurnOutcome"
import { QuestionDock } from "./QuestionDock"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { SuggestBar } from "./SuggestBar"
import {
  getMeasurement,
  getScroll,
  layoutFingerprint,
  resolveAnchor,
  rowFingerprint,
  setMeasurement,
  setScroll,
} from "./transcript-cache"
import {
  activeUserMessageID as getActiveUserMessageID,
  messageTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
  type MessageTurn,
} from "../../context/session-queue"
import { childID } from "../../context/session-utils"
import { taskResult } from "./task-tool-state"
import { activeQuestionTab, tr } from "./question-dock-utils"
import { useData } from "@kilocode/kilo-ui/context/data"
import { getDirectory as getRawDirectory, getFilename } from "@opencode-ai/core/util/path"
import {
  partitionRows,
  retainTurn,
  transcriptRows,
  type TranscriptErrorRow,
  type TranscriptHold,
  type TranscriptRow,
} from "../../context/transcript-rows"
import { onTimelineHighlight, type TimelineHighlight } from "../../utils/timeline/highlight"
import { useTranscriptSearch, type SearchMatch } from "../../context/transcript-search"
import { applyTranscriptHighlights, clearTranscriptHighlights } from "./transcript-search-highlight"
import {
  isUnauthorizedPaidModelError,
  isUnauthorizedPromotionLimitError,
  parseAssistantError,
  parseProviderAuthError,
  unwrapError,
} from "../../utils/errorUtils"
import type { Part, QuestionRequest, SuggestionRequest, ToolState } from "../../types/messages"

interface MessageListProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
  /** Non-tool question requests to render inline at the bottom of the message list */
  questions?: () => QuestionRequest[]
  /** Non-tool suggestion requests to render inline at the bottom of the message list */
  suggestions?: () => SuggestionRequest[]
  /** When true (subagent viewer), replace the welcome screen with an initializing indicator */
  readonly?: boolean
  /** Optionally replace the standard welcome content while the conversation is empty. */
  emptyState?: () => JSX.Element
  /** Announce transcript changes as a live log. Disable for multi-session surfaces with concurrent streams. */
  announce?: boolean
  sessionID?: Accessor<string | undefined>
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const provider = useProvider()
  const i18n = useI18n()
  const data = useData()
  // Only present inside Agent Manager (see worktree-mode.tsx). Agent Manager
  // never calls registerExpandedTaskTool(), so its "task" cards always fall
  // back to kilo-ui's default hideDetails renderer, which never shows a
  // task's result text — indexing it there would produce a phantom match.
  const inAgentManager = !!useWorktreeMode()

  // Mirrors message-part.tsx's own (unexported) relativizeProjectPath/
  // getDirectory exactly, so the directory text indexed here matches what
  // ToolMetaLine/ToolFileAccordion actually put on screen.
  function relativizeProjectPath(path: string, directory?: string) {
    if (!path) return ""
    if (!directory) return path
    if (directory === "/") return path
    if (directory === "\\") return path
    if (path === directory) return ""
    const separator = directory.includes("\\") ? "\\" : "/"
    const prefix = directory.endsWith(separator) ? directory : directory + separator
    if (!path.startsWith(prefix)) return path
    return path.slice(directory.length)
  }

  function getDirectory(path: string | undefined) {
    return relativizeProjectPath(getRawDirectory(path), data.directory)
  }

  const autoScroll = createAutoScroll({
    working: () => session.status() !== "idle",
  })
  const [announcement, setAnnouncement] = createSignal("")
  createEffect(
    (prev: { sid?: string; working: boolean }) => {
      const sid = session.currentSessionID()
      const working = session.status() !== "idle"
      if (working && (!prev.working || prev.sid !== sid)) setAnnouncement(language.t("session.status.working"))
      if (!working && prev.working && prev.sid === sid) {
        setAnnouncement(language.t("settings.agentBehaviour.editMode.save"))
      }
      return { sid, working }
    },
    { sid: undefined, working: false },
  )

  // Explicit output-producing actions resume auto-scroll before appending.
  const onResumeAutoScroll = () => autoScroll.resume()
  window.addEventListener("resumeAutoScroll", onResumeAutoScroll)
  onCleanup(() => window.removeEventListener("resumeAutoScroll", onResumeAutoScroll))

  let loaded = false
  createEffect(() => {
    if (!loaded && server.isConnected() && session.sessions().length === 0) {
      loaded = true
      session.loadSessions()
    }
  })

  const [scrollEl, setScrollEl] = createSignal<HTMLElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [layout, setLayout] = createSignal("")

  const revert = () => session.revert() ?? undefined
  const turns = createMemo((prev: MessageTurn[] | undefined) =>
    stableMessageTurns(
      messageTurns(session.messages(), revert(), (msg) => session.getParts(msg.id)),
      prev,
    ),
  )
  const isEmpty = () => turns().length === 0 && !session.loading() && !revert()

  const activeUserID = createMemo(() =>
    getActiveUserMessageID(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id)),
  )
  const queuedIDs = createMemo(
    () => new Set(queuedUserMessageIDs(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id))),
  )
  const rows = createMemo((prev: TranscriptRow[] | undefined) => {
    const active = activeUserID()
    return transcriptRows(
      turns(),
      (msg) => session.getParts(msg),
      {
        queued: queuedIDs(),
        live: new Set(active ? [active] : []),
        hidden: session.isErrorHidden,
        revert: revert(),
      },
      prev,
    )
  })

  const search = useTranscriptSearch()

  interface RowTextRange {
    start: number
    end: number
    partId: string
    /** For a multi-file apply_patch chunk, the file this range belongs to. */
    file?: string
  }

  /** A tool-text chunk, optionally attributed to a specific file within a
   * multi-file tool part (currently only apply_patch's per-file chunks). */
  type ToolChunk = string | { text: string; file: string }

  // Returns the row's full searchable text plus, for every chunk that came
  // from a specific part (tool call/reasoning/text/file), the character
  // range it occupies within that text. Lets a match's character index be
  // attributed back to the part it came from, so navigation can force that
  // exact collapsed tool/reasoning block open instead of just scrolling to
  // the row.
  function rowText(row: TranscriptRow): { text: string; ranges: RowTextRange[] } {
    if (row.type === "error") return { text: errorText(row.error), ranges: [] }
    if (row.type === "diff") return { text: "", ranges: [] }
    // User message text is rendered by UserMessageDisplay/HighlightedText
    // (message-part.tsx), which never parses markdown at all — [label](url)
    // always shows literally, brackets and all, unlike assistant text/
    // reasoning/tool content which goes through the real Markdown renderer.
    // Stripping link URLs there would wrongly collapse two genuinely
    // visible occurrences (the literal label and the literal URL) into one.
    const markdown = row.type !== "user"
    const chunks: string[] = []
    const ranges: RowTextRange[] = []
    let pos = 0
    const push = (text: string, partId: string, file?: string) => {
      if (!text) return
      if (chunks.length > 0) pos += 1 // account for the "\n" chunk joiner below
      chunks.push(text)
      ranges.push({ start: pos, end: pos + text.length, partId, file })
      pos += text.length
    }
    for (const part of row.parts) {
      switch (part.type) {
        case "text":
          if (!part.synthetic) push(markdown ? stripMarkdownLinkUrls(part.text) : part.text, part.id)
          break
        case "reasoning":
          push(stripMarkdownLinkUrls(part.text), part.id)
          break
        case "tool":
          // Bash output is rendered via escapeHtml + syntax highlighting
          // (never through Markdown at all), and the generic/MCP fallback
          // renderer wraps its output in a fenced code block before ever
          // reaching Markdown — both show link-like `[x](y)` text literally.
          // Stripping it here would search text that no longer matches the
          // literal characters on screen, the same class of mismatch this
          // rewrite fixes elsewhere.
          for (const chunk of toolText(part)) {
            if (typeof chunk === "string") push(chunk, part.id)
            else push(chunk.text, part.id, chunk.file)
          }
          break
        case "file":
          if (part.filename) push(part.filename, part.id)
          break
      }
    }
    return { text: chunks.join("\n"), ranges }
  }

  function rangeAt(ranges: RowTextRange[], index: number): RowTextRange | undefined {
    return ranges.find((r) => index >= r.start && index < r.end)
  }

  // Markdown link/image URLs are part of the raw source text but are never
  // rendered as visible text (only used as the href/src attribute) — a
  // common assistant pattern like [marked.tsx](path/to/marked.tsx) makes the
  // query match twice in raw text but appear only once in the DOM. Strips
  // that hidden half so counting mirrors what's actually on screen. Images
  // are removed entirely (their alt text isn't shown unless the image
  // fails to load); links keep only their visible label.
  //
  // Code fences/spans suppress all inline markdown parsing, so bracket/
  // paren text a user or assistant writes inside one (e.g. asking the
  // model to echo `[label](url)` verbatim) renders as literal, fully
  // visible text — split those segments out first and leave them alone, or
  // this would wrongly collapse two genuinely visible occurrences into one.
  function stripMarkdownLinkUrls(text: string): string {
    const segments = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    return segments.map((segment, i) => (i % 2 === 1 ? segment : stripLinks(segment))).join("")
  }

  function stripLinks(text: string): string {
    return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  }

  // Mirrors ErrorDisplay.tsx's exact Switch/Match classification so search
  // text matches what's actually on screen for every error variant, not
  // just the default card: the paid-model and promotion-limit prompts
  // render fixed localized copy (no user data at all), and the provider
  // auth prompt only renders when canAuth() would be true there too —
  // otherwise ErrorDisplay itself falls through to the default card.
  function errorText(error: TranscriptErrorRow["error"]): string {
    const value = error as ErrorDisplayProps["error"]
    const parsed = parseAssistantError(value)
    if (isUnauthorizedPaidModelError(parsed)) {
      return [language.t("error.paidModel.title"), language.t("error.paidModel.description")].join("\n")
    }
    if (isUnauthorizedPromotionLimitError(parsed)) {
      return [language.t("error.promotionLimit.title"), language.t("error.promotionLimit.description")].join("\n")
    }
    const auth = parseProviderAuthError(value)
    const authProvider = auth ? provider.providers()[auth.providerID] : undefined
    const authMethods = auth ? (provider.authMethods()[auth.providerID] ?? []) : []
    if (auth && authProvider && authMethods.length > 0) {
      const oauth = auth.providerID === "openai" && authMethods.some((method) => method.type === "oauth")
      const name = authProvider.name ?? auth.providerID
      const title = oauth
        ? language.t("error.providerAuth.chatgpt.title")
        : language.t("error.providerAuth.title", { provider: name })
      const description = oauth
        ? language.t("error.providerAuth.chatgpt.description")
        : language.t("error.providerAuth.description", { provider: name })
      return [title, description].join("\n")
    }
    const msg = error.data?.message
    if (typeof msg !== "string") return ""
    return unwrapError(msg)
  }

  // Extracts only the text kilo-ui's tool renderers actually put on screen —
  // matched field-by-field rather than reading `state.title` generically.
  // Uses one canonical extraction for both counting/navigation (this
  // function) and highlighting (transcript-search-highlight.ts scans the
  // rendered DOM) rather than two independently maintained notions of "the
  // tool's text" — a hand-picked field list here previously missed content
  // that's genuinely always on screen (e.g. a todowrite checklist's item
  // text), so a visible match could be highlighted in the DOM while the
  // counter still reported "No results" and navigation was disabled.
  //
  // read/glob/grep/list are the one confirmed exception: kilo-ui always
  // collapses them into a context-group summary (context-tool-results.tsx)
  // that never renders raw input/output text, even expanded — including
  // that text here would count matches with no corresponding highlight,
  // the same class of bug this rewrite fixes for every other tool.
  const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])

  // edit/write/apply_patch render their actual diff content through
  // @pierre/diffs inside a shadow-DOM <diffs-container> (packages/ui/src/
  // pierre/file-runtime.ts's getViewerRoot()), which a light-DOM text scan
  // can never reach — and diff-mode rendering is virtualized by default, so
  // even piercing the shadow root wouldn't guarantee off-screen lines are
  // mounted. state.input/state.metadata also duplicate the full before/
  // after file content and the path itself several times over (a unified
  // patch string with the path repeated in its `---`/`+++` headers, a
  // separate raw `metadata.diff` copy, write's extra top-level
  // `metadata.filepath`), none of which corresponds 1:1 with what's on
  // screen. Rather than collect+dedupe those redundant fields, mirror the
  // renderer's fixed, known layout directly: edit/write always show one
  // file's path in exactly two places (the BasicTool trigger's
  // ToolMetaLine and that file's own accordion header); apply_patch's
  // trigger only adds a third, single-file ToolMetaLine when there's
  // exactly one file (message-part.tsx's `single()`) — for a multi-file
  // patch each file's name only appears once, in its own accordion header.
  const DIFF_TOOLS = new Set(["edit", "write"])
  // todowrite's renderer resolves the shown list from a fallback chain
  // (metadata.view.todos, else metadata.todos, else input.todos) —
  // packages/opencode/src/tool/todo.ts sets metadata.todos to the exact
  // same array as input.todos, and metadata.view.todos to the exact same
  // content again whenever the view is in "full" mode (the common case,
  // see packages/opencode/src/kilocode/todo-view.ts). Recursively collecting
  // both input and metadata would count every todo's text 2-3x even though
  // shown() only ever renders it once.
  // todoread is deliberately excluded: AssistantMessage.tsx's isRenderable()
  // only shows a completed part from UPSTREAM_SUPPRESSED_TOOLS when
  // ToolRegistry has a renderer for it, and only "todowrite" is registered —
  // a completed todoread never reaches the DOM, so indexing it would count
  // matches with nothing to highlight or navigate to.
  const TODO_TOOLS = new Set(["todowrite"])

  function toolText(part: Part & { type: "tool" }): ToolChunk[] {
    const state = part.state
    if (state.status === "error") return state.error ? [state.error] : []
    // task's trigger (title "{type} Agent" + input.description subtitle) and
    // question's dock (question text + full option list) render the same
    // way whether the call is still pending/running or already completed —
    // unlike every other tool, where only a bare title shows until
    // completion — so both need handling before the completed-only gate
    // below, or an in-progress task/question would index nothing at all.
    if (part.tool === "task") return taskText(part, state)
    if (part.tool === "question") return questionText(part, state)
    if (state.status !== "completed") return "title" in state && state.title ? [state.title] : []
    if (CONTEXT_GROUP_TOOLS.has(part.tool)) return state.title ? [state.title] : []
    if (part.tool === "bash") return bashText(state)
    if (part.tool === "apply_patch") return applyPatchText(state)
    if (DIFF_TOOLS.has(part.tool)) return editWriteText(part.tool, state)
    if (TODO_TOOLS.has(part.tool)) return todoText(state)
    const chunks: string[] = []
    if (state.title) chunks.push(state.title)
    collectStrings(state.input, chunks)
    collectStrings(state.metadata, chunks)
    if (typeof state.output === "string" && state.output) chunks.push(mcpOutputText(state.output))
    return chunks
  }

  // transcript-search-highlight.ts's scanScope() walks the whole [data-part-
  // id] subtree for this tool, which includes the ToolTriggerRow's title
  // ("To-dos") and "completed/total" subtitle alongside each item's content
  // — indexing only item content undercounts what's actually scanned there,
  // shifting which range resolveSearchScopes/scanScope picks as "active".
  function todoText(state: Extract<ToolState, { status: "completed" }>): string[] {
    const metadata = state.metadata as { todos?: unknown; view?: unknown } | undefined
    const input = state.input as { todos?: unknown } | undefined
    const view = metadata?.view
    const viewTodos = isTodoView(view) ? view.todos : undefined
    // Matches the renderer's own `todos()` memo (used for the "N/M"
    // subtitle): metadata.todos, else input.todos — never the (possibly
    // view-truncated) compact list.
    const full =
      (Array.isArray(metadata?.todos) ? metadata.todos : undefined) ??
      (Array.isArray(input?.todos) ? input.todos : undefined) ??
      []
    const shown = viewTodos ?? full
    const chunks: string[] = [i18n.t("ui.tool.todos")]
    if (full.length > 0) {
      const completed = (full as { status?: unknown }[]).filter((t) => t?.status === "completed").length
      chunks.push(`${completed}/${full.length}`)
    }
    for (const content of (shown as { content?: unknown }[]).map((todo) => todo?.content)) {
      if (typeof content === "string" && content.length > 0) chunks.push(content)
    }
    return chunks
  }

  function isTodoView(value: unknown): value is { todos?: { content?: unknown }[] } {
    return !!value && typeof value === "object" && Array.isArray((value as { todos?: unknown }).todos)
  }

  // Matches TaskToolExpanded.tsx (the renderer this webview actually
  // registers for "task", overriding kilo-ui's default) exactly: title is
  // always `i18n.t("ui.tool.agent", { type })` regardless of status — the
  // "capitalize" CSS class only changes how it *looks*, the DOM text node
  // itself is the raw, lowercase subagent_type. The "(N)" child-tool-count
  // suffix shown there is a live value from session.getSessionToolCount(),
  // not stored on the part at all, so it can't be indexed from a snapshot —
  // searching for that count isn't meaningful content anyway.
  function taskText(part: Part & { type: "tool" }, state: ToolState): string[] {
    const input = state.input as { subagent_type?: string; description?: string } | undefined
    const type = input?.subagent_type || part.tool
    const chunks = [i18n.t("ui.tool.agent", { type })]
    if (input?.description) chunks.push(input.description)
    // TaskToolExpanded.tsx only shows the raw <task_result> body when there's
    // no live child session to display instead (result() there resolves to
    // undefined once a child session exists) — mirror that exactly so a
    // completed task with no child session stays searchable, without
    // indexing text that's actually replaced by the child tool list. Agent
    // Manager never registers TaskToolExpanded at all (it always uses
    // kilo-ui's default hideDetails task card, which never shows result
    // text there), so skip this entirely in that surface.
    if (state.status === "completed" && !inAgentManager) {
      const child = childID({
        type: "tool",
        tool: part.tool,
        metadata: part.metadata as { sessionId?: string } | undefined,
        state: { metadata: state.metadata },
      })
      const result = taskResult(state.output, child)
      if (result) chunks.push(stripMarkdownLinkUrls(result))
    }
    return chunks
  }

  // QuestionDock renders very different content depending on whether the
  // question is still awaiting an answer or already resolved: while
  // pending/running it shows the full clickable option list (label +
  // description per option); once completed it only shows the question
  // text plus whichever answer was actually given (dismissed questions show
  // neither the options nor a real answer, just a static "dismissed"
  // label that isn't meaningful content to index).
  type QuestionOption = { label?: string; description?: string; labelKey?: string; descriptionKey?: string }
  type QuestionInfo = { question?: string; questionKey?: string; options?: QuestionOption[] }

  // Correlates a "question" tool part to its live QuestionRequest the same
  // way AssistantMessage.tsx's matchToolRequest does (by callID/messageID),
  // so the pending branch below can read which page QuestionDock actually
  // has mounted (question-dock-utils.ts's activeQuestionTab) instead of
  // assuming it's always the first one.
  function liveQuestionRequestId(part: Part & { type: "tool" }): string | undefined {
    return session.questions().find((r) => r.tool?.callID === part.callID && r.tool?.messageID === part.messageID)?.id
  }

  function questionText(part: Part & { type: "tool" }, state: ToolState): string[] {
    const input = state.input as { questions?: QuestionInfo[] } | undefined
    const questions = input?.questions ?? []
    const done = state.status === "completed"
    const metadata = done ? (state.metadata as { answers?: unknown; dismissed?: unknown } | undefined) : undefined
    const answers = Array.isArray(metadata?.answers) ? (metadata!.answers as unknown[][]) : undefined
    const dismissed = metadata?.dismissed === true
    const requestId = done ? undefined : liveQuestionRequestId(part)
    const mountedTab = requestId ? activeQuestionTab(requestId) : 0
    const chunks: string[] = []
    questions.forEach((q, i) => {
      // The pending QuestionDock renders localized text via questionKey/
      // labelKey/descriptionKey (see question-dock-utils.ts's tr()), with
      // the raw wire strings kept only as untranslated fallbacks/reply
      // values. Once completed, kilo-ui's question renderer instead shows
      // the raw `q.question` directly (no questionKey lookup) — index
      // whichever one that surface actually displays.
      const questionLabel = done ? (q.question ?? "") : tr(language.t, q.questionKey, q.question ?? "")
      if (questionLabel) chunks.push(questionLabel)
      if (!done) {
        // QuestionDock only ever mounts one page (store.tab) of a pending
        // multi-question at a time — limit to the page it has published as
        // mounted (question-dock-utils.ts), which stays correct as the user
        // navigates instead of freezing on page 0.
        if (i !== mountedTab) return
        for (const option of q.options ?? []) {
          const label = tr(language.t, option.labelKey, option.label ?? "")
          if (label) chunks.push(label)
          const description = option.description ? tr(language.t, option.descriptionKey, option.description) : ""
          if (description) chunks.push(description)
        }
        return
      }
      if (dismissed) return
      for (const value of answers?.[i] ?? []) {
        if (typeof value === "string" && value) chunks.push(value)
      }
    })
    return chunks
  }

  type Diagnostic = { severity: number; range: { start: { line: number; character: number } }; message: string }

  // Mirrors getDiagnostics()/DiagnosticsDisplay in message-part.tsx: up to 3
  // severity-1 diagnostics for the file, each shown as an "Error" label, a
  // "[line:char]" location, and the diagnostic message.
  function editWriteDiagnostics(metadata: unknown, filePath: string | undefined): string[] {
    const byFile = (metadata as { diagnostics?: Record<string, Diagnostic[]> } | undefined)?.diagnostics
    if (!byFile || !filePath) return []
    const diagnostics = (byFile[filePath] ?? []).filter((d) => d.severity === 1).slice(0, 3)
    const chunks: string[] = []
    for (const d of diagnostics) {
      chunks.push(i18n.t("ui.messagePart.diagnostic.error"))
      chunks.push(`[${d.range.start.line + 1}:${d.range.start.character + 1}]`)
      if (d.message) chunks.push(d.message)
    }
    return chunks
  }

  // edit/write show a file's path in two places with different layouts:
  // the BasicTool trigger's ToolMetaLine (filename, then — only when the raw
  // input path has a directory — the directory, bidi-isolated) and that
  // file's own accordion header (directory-then-filename, same bidi
  // wrapper). edit's accordion can source a different path than the
  // trigger (metadata.filediff.file falls back to input.filePath); write
  // uses input.filePath for both. Mirror both occurrences exactly rather
  // than indexing the raw path string, which never appears in the DOM as a
  // single contiguous run.
  function editWriteText(tool: string, state: Extract<ToolState, { status: "completed" }>): string[] {
    const input = state.input as { filePath?: string } | undefined
    const metadata = state.metadata as
      | { filepath?: string; filediff?: { file?: string }; diagnostics?: Record<string, Diagnostic[]> }
      | undefined
    const triggerPath = input?.filePath
    const accordionPath = tool === "edit" ? (metadata?.filediff?.file ?? triggerPath) : triggerPath
    const chunks: string[] = []
    if (triggerPath) {
      chunks.push(getFilename(triggerPath))
      if (triggerPath.includes("/")) chunks.push(`\u2066${getDirectory(triggerPath)}\u2069`)
    }
    if (accordionPath) {
      if (accordionPath.includes("/")) chunks.push(`\u2066${getDirectory(accordionPath)}\u2069`)
      chunks.push(getFilename(accordionPath))
    }
    chunks.push(...editWriteDiagnostics(metadata, triggerPath))
    return chunks
  }

  function applyPatchText(state: Extract<ToolState, { status: "completed" }>): ToolChunk[] {
    const files = ((state.metadata as { files?: { filePath?: string; relativePath?: string }[] } | undefined)?.files ??
      []) as { filePath?: string; relativePath?: string }[]
    // Only when there's exactly one file does the trigger also show a
    // ToolMetaLine for it (filename, then bidi-isolated directory), ON TOP
    // OF that file's own ToolFileAccordion header (bidi-isolated directory,
    // then filename) — both are rendered simultaneously for a single-file
    // patch, same as edit/write's two-location layout in editWriteText.
    // For a multi-file patch each file's name only appears once, in its own
    // accordion header. Multi-file chunks are tagged with the file's
    // `filePath` (matching the accordion's item key) so a match can force
    // just that one nested item open instead of every file.
    const single = files.length === 1
    const chunks: ToolChunk[] = []
    for (const file of files) {
      const path = file.relativePath ?? file.filePath
      if (!path || !file.filePath) continue
      const dir = path.includes("/") ? `\u2066${getDirectory(path)}\u2069` : undefined
      if (single) {
        chunks.push(getFilename(path))
        if (dir) chunks.push(dir)
        if (dir) chunks.push(dir)
        chunks.push(getFilename(path))
        continue
      }
      const tag = (text: string): ToolChunk => ({ text, file: file.filePath! })
      if (dir) chunks.push(tag(dir))
      chunks.push(tag(getFilename(path)))
    }
    return chunks
  }

  // Mirrors McpTool's formattedOutput(): if `output` parses as JSON, the
  // renderer pretty-prints it inside a fenced ```json block, so it's shown
  // literally, same as bash. If it isn't valid JSON — the common case for a
  // tool returning prose or markdown — the renderer feeds the raw string
  // straight into the real Markdown component, which *does* parse
  // `[label](url)` into an actual link, hiding the URL half. Strip it there
  // the same as text/reasoning chunks, or a non-JSON tool result reintroduces
  // the exact mismatch this rewrite otherwise fixes.
  function mcpOutputText(output: string): string {
    try {
      JSON.parse(output)
      return output
    } catch {
      return stripMarkdownLinkUrls(output)
    }
  }

  function bashText(state: Extract<ToolState, { status: "completed" }>) {
    const input = state.input as { command?: string; description?: string } | undefined
    const metadata = state.metadata as { command?: string; description?: string } | undefined
    const command = input?.command ?? metadata?.command
    const description = input?.description ?? metadata?.description
    const chunks: string[] = []
    // DOM order: description renders as the header subtitle (above the
    // command box), command renders below it, output last — keep this in
    // sync with shell-rolling-results.tsx so occurrence numbering lines up
    // with what's actually highlighted on screen.
    if (description) chunks.push(description)
    if (command) chunks.push(command)
    if (state.output) chunks.push(state.output)
    return chunks
  }

  // Recursively collects every string leaf value from a tool's `input`/
  // `metadata` (JSON-like objects/arrays of unknown shape), so nested
  // rendered text — a todo item's `content`, a question's `question` text,
  // a skill's `name` — is included without hand-modeling each tool's shape.
  function collectStrings(value: unknown, out: string[], depth = 0): void {
    if (depth > 4 || value === undefined || value === null) return
    if (typeof value === "string") {
      if (value) out.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, out, depth + 1)
      return
    }
    if (typeof value === "object") {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        collectStrings((value as Record<string, unknown>)[key], out, depth + 1)
      }
    }
  }

  function buildPattern(query: string, matchCase: boolean, wholeWord: boolean, regex: boolean): RegExp | undefined {
    if (!query) return undefined
    try {
      let pattern = query
      if (!regex) {
        pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      }
      if (wholeWord) {
        // Unicode-aware boundary: plain `\b` only treats ASCII letters/
        // digits/underscore as "word" characters, so it silently breaks
        // whole-word matching for Cyrillic, Arabic, CJK, and other non-ASCII
        // text. `\p{L}`/`\p{M}`/`\p{N}` (letters/marks/numbers) require the
        // `u` flag, applied below for every pattern, not just this one.
        pattern = `(?<![\\p{L}\\p{M}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_])`
      }
      return new RegExp(pattern, matchCase ? "gu" : "giu")
    } catch {
      return undefined
    }
  }

  const pattern = createMemo(() => {
    const q = search.query()
    if (!search.active() || !q) return undefined
    return buildPattern(q, search.matchCase(), search.wholeWord(), search.regex())
  })

  // An invalid regex (e.g. an unbalanced group) compiles to `undefined` from
  // buildPattern, which otherwise looks identical to "no matches" — surface
  // it explicitly so the widget can show a real error instead.
  createEffect(() => {
    const q = search.query()
    search.setInvalid(search.active() && !!q && search.regex() && !pattern())
  })

  // Sessions only load the most recent page (session.tsx's MESSAGE_PAGE_LIMIT)
  // up front; matches() only ever sees currently-loaded rows(). Without this,
  // an active search would silently miss everything in older, not-yet-loaded
  // history — undermining the main "find something in a long session" use
  // case, and a partial match count while some history remains unsearched
  // could actively mislead a user into the wrong conclusion. While a query
  // is active, keep requesting older pages until there aren't any more or
  // the search is no longer active; each completed load feeds back into
  // hasOlderMessages()/loadingOlderMessages(), both tracked here, so this
  // effect naturally re-fires and continues the chain without an explicit
  // loop. searchingHistory (surfaced to the widget) stays true for that
  // whole stretch, so "No results"/a final count aren't shown until the
  // entire session has actually been searched.
  //
  // Deliberately uncapped: an earlier revision capped this and offered an
  // opt-in to search further, but a possibly-incomplete count is worse than
  // the cost of loading a very long session's full history. Revisit with a
  // cap (or a lazy/incremental search strategy) in a follow-up if this
  // proves too slow/expensive in practice on very long sessions.
  createEffect(() => {
    const searching = search.active() && !!search.query() && session.hasOlderMessages()
    search.setSearchingHistory(searching)
    if (!searching || session.loadingOlderMessages()) return
    session.loadOlderMessages()
  })

  const matches = createMemo(() => {
    const p = pattern()
    if (!p) return []
    const list = rows()
    const result: SearchMatch[] = []
    for (const row of list) {
      const { text, ranges } = rowText(row)
      p.lastIndex = 0
      let occurrence = 0
      let hit = p.exec(text)
      while (hit) {
        if (hit[0].length === 0) {
          p.lastIndex += 1
          hit = p.exec(text)
          continue
        }
        const range = rangeAt(ranges, hit.index)
        result.push({ key: row.key, occurrence, partId: range?.partId, partFile: range?.file })
        occurrence += 1
        hit = p.exec(text)
      }
    }
    return result
  })

  createEffect(
    on(matches, (m) => {
      search.setCount(m.length)
      if (m.length === 0) {
        search.setIndex(0)
        return
      }
      const idx = search.index()
      if (idx >= m.length) search.setIndex(m.length - 1)
    }),
  )

  createEffect(
    on(
      () => [search.query(), search.matchCase(), search.wholeWord(), search.regex()],
      () => {
        search.setIndex(0)
        // Jump straight to the first match as the user types/toggles an
        // option, instead of leaving them to press Enter/an arrow just to
        // see where the current query actually landed. `requestJump` is a
        // no-op when there are no matches (guarded in the jump effect).
        search.requestJump()
      },
    ),
  )

  // Closing/switching to a different session leaves stale query/matches
  // bound to a transcript that's no longer displayed if left untouched —
  // reset the whole widget whenever the current session changes. `defer:
  // true` skips the initial run so mounting doesn't immediately "reset" a
  // session that was never open in this search widget.
  createEffect(
    on(
      () => session.currentSessionID(),
      () => {
        search.setActive(false)
        search.setQuery("")
        search.setMatchCase(false)
        search.setWholeWord(false)
        search.setRegex(false)
        search.setIndex(0)
        search.setCount(0)
      },
      { defer: true },
    ),
  )

  const activeKey = createMemo(() => {
    const m = matches()
    const idx = search.index()
    return m[idx]?.key
  })

  const activeMatch = createMemo(() => matches()[search.index()])

  // Maps a row's key to the part ids the data model could attribute matches
  // to there. A row with NO entry here has zero data-level matches, so the
  // highlighter must scan nothing in it at all — otherwise unindexed text (a
  // static button label, a sibling part that didn't match) could get
  // highlighted despite never being counted. An entry always exists for
  // every row that has at least one match, even with an empty part-id set
  // (a match that couldn't be attributed to a specific part, e.g. error/diff
  // rows) — the highlighter treats "entry exists" as "this row has a real
  // match" and falls back to scanning the whole row whenever the part-id
  // lookup doesn't resolve to a mounted element.
  const matchedPartsByRow = createMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const match of matches()) {
      const set = map.get(match.key) ?? new Set<string>()
      if (match.partId) set.add(match.partId)
      map.set(match.key, set)
    }
    return map
  })

  // Highlights every rendered occurrence of the query (not just matching
  // rows) via the CSS Custom Highlight API, and returns the precise Range of
  // the current occurrence so navigation can judge whether it needs to
  // scroll at all (several occurrences can share one message).
  let highlightFrame: number | undefined
  let highlightFrameInner: number | undefined
  let pendingCenter = false
  const paintHighlights = () => {
    const el = scrollEl()
    if (!el || !search.active()) {
      clearTranscriptHighlights()
      return
    }
    const active = activeMatch()
    const range = applyTranscriptHighlights(
      el,
      pattern(),
      active && { key: active.key, occurrence: active.occurrence },
      matchedPartsByRow(),
    )
    if (!pendingCenter) return
    pendingCenter = false
    if (!range) return
    // Only nudge the scroll position when the match isn't already
    // comfortably placed — re-centering on every single step (even when
    // the match is already visible) reads as constant, distracting jumping
    // when several occurrences share one message.
    const rect = range.getClientRects()[0]
    if (!rect) return
    const box = el.getBoundingClientRect()
    const fullyVisible = rect.top >= box.top && rect.bottom <= box.bottom
    // Comfort band covers the middle 70% of the viewport (15% margin top
    // and bottom) — wide enough that most steps between nearby matches
    // don't scroll at all, while still recentering before a match gets
    // uncomfortably close to the edge.
    const comfortMargin = box.height * 0.35
    const centered = Math.abs(rect.top + rect.height / 2 - (box.top + box.height / 2)) <= comfortMargin
    if (fullyVisible && centered) return
    const container = range.startContainer
    const target = container instanceof Element ? container : container?.parentElement
    target?.scrollIntoView({ block: "center", inline: "nearest" })
  }

  // Two frames of margin so the virtualizer has settled the DOM for the new
  // scroll position before we scan it for the precise occurrence to center.
  // Both frame ids are tracked so cleanup can cancel whichever leg of the
  // chain hasn't fired yet — cancelling only the outer id left the inner,
  // already-scheduled frame free to fire (and touch reactive state) after
  // the component had already unmounted.
  const scheduleHighlight = () => {
    if (highlightFrame !== undefined) return
    highlightFrame = requestAnimationFrame(() => {
      highlightFrameInner = requestAnimationFrame(() => {
        highlightFrame = undefined
        highlightFrameInner = undefined
        paintHighlights()
      })
    })
  }

  createEffect(
    on(
      () => [search.query(), search.matchCase(), search.wholeWord(), search.regex(), search.active(), activeMatch()],
      scheduleHighlight,
    ),
  )

  createEffect(
    on(
      () => search.jump(),
      () => {
        const m = matches()
        const idx = search.index()
        if (!m.length || idx < 0 || idx >= m.length) return
        const match = m[idx]
        if (!match) return
        autoScroll.pause()
        pendingCenter = true
        const el = scrollEl()
        const mounted = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(match.key)}"]`)
        // Only force the coarse row-level scroll when the row isn't in the
        // DOM at all (virtualized out). If it's already mounted, defer
        // entirely to the precise per-occurrence check in paintHighlights,
        // which only scrolls when the exact match actually needs it.
        if (!mounted) {
          const index = keys().indexOf(match.key)
          if (index >= 0) {
            virtualizer()?.scrollToIndex(index, { align: "center" })
          }
        }
        scheduleHighlight()
      },
    ),
  )

  onCleanup(() => {
    if (highlightFrame !== undefined) cancelAnimationFrame(highlightFrame)
    if (highlightFrameInner !== undefined) cancelAnimationFrame(highlightFrameInner)
    clearTranscriptHighlights()
  })

  const [held, setHeld] = createSignal<TranscriptHold>()
  createEffect(() => {
    const id = activeUserID()
    const sid = session.currentSessionID()
    const paused = autoScroll.userScrolled()
    setHeld((prev) => retainTurn(prev, sid, id, paused))
  })
  const direct = createMemo(() => {
    const item = held()
    const ids = new Set<string>()
    if (item && item.sid === session.currentSessionID()) ids.add(item.turn)
    const active = activeUserID()
    if (active) ids.add(active)
    return ids
  })
  // Virtua continues to own completed history and stable live chunks, but not
  // the growing assistant suffix whose measurements would produce visible jumps.
  const partition = createMemo(() => partitionRows(rows(), direct()))
  const tail = createMemo(() => partition().direct.map((row) => row.key))
  const lookup = createMemo(() => new Map(partition().direct.map((row) => [row.key, row])))
  const keys = createMemo(() => partition().virtual.map((row) => row.key))
  const fingerprint = createMemo(() => rowFingerprint(keys()))

  // Clicking a bar in the task timeline scrolls the transcript to that message.
  // Jumps land instantly (no smooth animation): while pinned at the bottom, a
  // smooth scroll's initial frames sit within createAutoScroll's near-bottom
  // threshold, which resumes auto-follow mid-animation and snaps back down.
  const onScrollToMessage = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string; partId?: string }>).detail
    if (!detail?.id) return
    const matches = rows().filter((r) => r.type === "assistant" && r.message.id === detail.id)
    // Long messages split into multiple rows (chunks); land on the chunk that
    // actually contains the clicked part, not just the message's first chunk.
    const row = matches.find((r) => r.type === "assistant" && r.parts.some((p) => p.id === detail.partId)) ?? matches[0]
    if (!row) return
    autoScroll.pause()
    const index = keys().indexOf(row.key)
    if (index >= 0) {
      virtualizer()?.scrollToIndex(index, { align: "start" })
      return
    }
    const el = scrollEl()
    const target = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(row.key)}"]`)
    target?.scrollIntoView({ block: "start" })
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

  // Highlights the part behind the currently hovered/focused timeline bar
  // (dispatched by TaskTimeline) so the two stay visually correlated.
  const [highlight, setHighlight] = createSignal<TimelineHighlight>()
  onCleanup(onTimelineHighlight(setHighlight))

  const measurement = createMemo(() => {
    const id = session.currentSessionID()
    const token = layout()
    if (!id || !token || session.loading() || keys().length === 0) return undefined
    return getMeasurement(id, fingerprint(), token)
  })

  let active = { id: session.currentSessionID(), keys: keys(), fingerprint: fingerprint() }
  createEffect(() => {
    const id = session.currentSessionID()
    const current = keys()
    const value = fingerprint()
    if (!id || session.loading() || active.id !== id) return
    active = { id, keys: current, fingerprint: value }
  })

  const save = (id: string | undefined, saved = active) => {
    const el = scrollEl()
    if (!id || !el || saved.id !== id) return
    const handle = virtualizer()
    const token = layout()
    if (handle && token && saved.keys.length > 0) {
      setMeasurement(id, saved.fingerprint, token, handle.cache)
    }
    if (!autoScroll.userScrolled()) {
      setScroll(id, { type: "bottom" })
      return
    }
    if (!handle || saved.keys.length === 0) return
    const index = handle.findItemIndex(handle.scrollOffset)
    const key = saved.keys[index]
    if (!key) return
    setScroll(id, { type: "anchor", key, offset: handle.scrollOffset - handle.getItemOffset(index) })
  }

  const maybeLoadOlder = () => {
    const el = scrollEl()
    if (!el || el.scrollTop > 600) return
    session.loadOlderMessages()
  }

  const handleScroll = () => {
    autoScroll.handleScroll()
    maybeLoadOlder()
    if (search.active()) scheduleHighlight()
  }

  let resize: ResizeObserver | undefined
  const refreshLayout = () => {
    const el = scrollEl()
    if (!el) return
    const style = getComputedStyle(el)
    setLayout(
      layoutFingerprint({
        width: Math.round(el.clientWidth),
        ratio: window.devicePixelRatio,
        font: style.fontFamily,
        size: style.fontSize,
        line: style.lineHeight,
      }),
    )
  }
  const setScrollRef = (el: HTMLElement | undefined) => {
    resize?.disconnect()
    setScrollEl(el)
    autoScroll.scrollRef(el)
    if (!el) return
    refreshLayout()
    resize = new ResizeObserver(refreshLayout)
    resize.observe(el)
  }
  window.addEventListener("resize", refreshLayout)
  document.fonts?.addEventListener("loadingdone", refreshLayout)
  onCleanup(() => {
    resize?.disconnect()
    window.removeEventListener("resize", refreshLayout)
    document.fonts?.removeEventListener("loadingdone", refreshLayout)
  })

  const [pendingRestore, setPendingRestore] = createSignal<string>()

  createEffect(
    on(session.currentSessionID, (id, prev) => {
      save(prev)
      active = { id, keys: [], fingerprint: rowFingerprint([]) }
      setPendingRestore(id)
    }),
  )

  createEffect(() => {
    const id = pendingRestore()
    if (!id || session.loading()) return
    turns().length
    // Double-rAF: the first frame lets the browser paint the new DOM from
    // the messagesLoaded batch. The second frame restores scroll position
    // without forcing a synchronous layout reflow mid-paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pendingRestore() !== id) return
        const el = scrollEl()
        if (!el) return
        const state = getScroll(id)
        const anchor = resolveAnchor(state, keys())
        const handle = virtualizer()
        if (state?.type === "anchor" && anchor && handle) {
          handle.scrollToIndex(anchor.index, { offset: anchor.offset })
          autoScroll.pause()
          maybeLoadOlder()
        } else {
          autoScroll.forceScrollToBottom()
        }
        setPendingRestore(undefined)
      })
    })
  })

  onCleanup(() => save(session.currentSessionID()))

  return (
    <div class="message-list-container">
      <Show when={props.announce === false}>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement()}
        </div>
      </Show>
      <Show when={isEmpty()}>
        <div class="welcome-header">
          <AccountSwitcher class="account-switcher-welcome" />
          <KiloNotifications sessionID={props.sessionID} />
        </div>
      </Show>
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        class="message-list"
        role={props.announce === false ? undefined : "log"}
        aria-live={props.announce === false ? undefined : "polite"}
        aria-busy={props.announce === false && session.status() !== "idle" ? "true" : undefined}
      >
        <div ref={autoScroll.contentRef} class={isEmpty() ? "message-list-content-empty" : "message-list-content"}>
          <Show when={session.loading()}>
            <div class="message-list-loading" role="status">
              <Spinner />
              <span>{language.t("session.messages.loading")}</span>
            </div>
          </Show>
          <Show when={isEmpty() && props.readonly}>
            <div class="message-list-empty">
              <p class="kilo-about-text">{language.t("session.messages.initializing")}</p>
            </div>
          </Show>
          <Show when={isEmpty() && !props.readonly}>
            {props.emptyState ? (
              props.emptyState()
            ) : (
              <WelcomeEmptyState onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
            )}
          </Show>
          <Show when={!session.loading() && !isEmpty()}>
            <Show when={session.loadingOlderMessages()}>
              <div class="message-list-page-loader" role="status">
                <Spinner />
                <span>{language.t("session.messages.loadingEarlier")}</span>
              </div>
            </Show>
            <Show when={session.hasOlderMessages() && !session.loadingOlderMessages()}>
              <button class="message-list-load-older" onClick={() => session.loadOlderMessages()}>
                {language.t("session.messages.loadEarlier")}
              </button>
            </Show>
            <Show when={partition().virtual.length > 0 || partition().direct.length > 0}>
              <div
                class="message-list-turns"
                data-loaded-messages={session.messages().length}
                data-row-count={partition().virtual.length}
                data-direct-count={partition().direct.length}
                data-queued-count={partition().queued.length}
              >
                <Show when={scrollEl() && partition().virtual.length > 0}>
                  <Virtualizer
                    ref={setVirtualizer}
                    data={partition().virtual}
                    scrollRef={scrollEl()}
                    shift={session.messageMutation() === "prepend"}
                    cache={measurement()}
                    bufferSize={520}
                    itemSize={260}
                  >
                    {(row, index) => (
                      <TranscriptRowView
                        row={row}
                        index={index()}
                        onForkMessage={props.onForkMessage}
                        highlight={highlight}
                        activeSearch={activeKey() === row.key}
                        activeSearchPartID={activeKey() === row.key ? activeMatch()?.partId : undefined}
                        activeSearchPartFile={activeKey() === row.key ? activeMatch()?.partFile : undefined}
                      />
                    )}
                  </Virtualizer>
                </Show>
                <For each={tail()}>
                  {(key) => (
                    <TranscriptRowView
                      row={lookup().get(key)!}
                      onForkMessage={props.onForkMessage}
                      highlight={highlight}
                      activeSearch={activeKey() === key}
                      activeSearchPartID={activeKey() === key ? activeMatch()?.partId : undefined}
                      activeSearchPartFile={activeKey() === key ? activeMatch()?.partFile : undefined}
                    />
                  )}
                </For>
              </div>
            </Show>
            <Show when={revert()}>
              <RevertBanner />
            </Show>
            <For each={partition().queued}>
              {(row) => (
                <TranscriptRowView
                  row={row}
                  activeSearch={activeKey() === row.key}
                  activeSearchPartID={activeKey() === row.key ? activeMatch()?.partId : undefined}
                  activeSearchPartFile={activeKey() === row.key ? activeMatch()?.partFile : undefined}
                />
              )}
            </For>
            <WorkingIndicator />
            <TurnOutcome />
            <For each={props.questions?.()}>{(req) => <QuestionDock request={req} />}</For>
            <For each={props.suggestions?.()}>{(req) => <SuggestBar request={req} />}</For>
          </Show>
        </div>
      </div>

      <Show when={autoScroll.userScrolled()}>
        <button
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        >
          <Icon name="arrow-down-to-line" />
        </button>
      </Show>
    </div>
  )
}
