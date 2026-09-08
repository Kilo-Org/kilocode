/**
 * PromptInput component
 * Text input with send/abort buttons, ghost-text autocomplete, and @ file mention support
 */

import { createSignal, createEffect, on, For, Index, onCleanup, Show, untrack, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { showToast } from "@kilocode/kilo-ui/toast"
import { hasPopup, isTextControl } from "../../utils/focus"
import { useSession } from "../../context/session"
import { revertPromptState } from "../../context/session-utils"
import { useLocalTabs } from "../../context/local-tabs"
import { useServer } from "../../context/server"
import { useIndexing } from "../../context/indexing"
import { indexingButtonVisible } from "../../context/indexing-utils"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { ModelSelector } from "../shared/ModelSelector"
import { ModeSwitcher } from "../shared/ModeSwitcher"
import { SandboxButtonBase, SandboxTooltipContent } from "../shared/SandboxButton"
import { SpeechToTextButton } from "../speech-to-text/SpeechToTextButton"
import { canUseSpeechToText, selectedSpeechToTextModel } from "../speech-to-text/availability"
import { ThinkingSelector } from "../shared/ThinkingSelector"
import { useFileMention } from "../../hooks/useFileMention"
import type { MentionResult, WorktreeReference } from "../../hooks/file-mention-utils"
import { isMentionEntry } from "../../hooks/file-mention-utils"
import { useTerminalContext } from "../../hooks/useTerminalContext"
import { useGitChangesContext } from "../../hooks/useGitChangesContext"
import { hasTerminalMention } from "../../hooks/terminal-context-utils"
import { hasGitChangesMention } from "../../hooks/git-changes-context-utils"
import { useSlashCommand } from "../../hooks/useSlashCommand"
import { useGoalComposer } from "./goal/useGoalComposer"
import { GoalHeader } from "./goal/GoalHeader"
import { useGhostText } from "../../hooks/useGhostText"
import { useSpeechToText } from "../speech-to-text/useSpeechToText"
import { useSpeechToTextModels } from "../../context/speech-to-text-models"
import { createSpeechShortcut } from "../speech-to-text/shortcut"
import { useImageAttachments, type ImageAttachment } from "../../hooks/useImageAttachments"
import { convertToMentionPath, insertPathMentions } from "../../utils/path-mentions"
import { SessionMentionPicker } from "./SessionMentionPicker"
import { formatRelativeDate } from "../../utils/date"
import { WorktreeMentionPicker } from "./WorktreeMentionPicker"
import { usePromptHistory } from "../../hooks/usePromptHistory"
import { cycleVariant } from "../../context/session-variant-store"
import { WandSparkles } from "@kilocode/kilo-ui/lucide"
import {
  fileName,
  dirName,
  buildHighlightSegments,
  atEnd,
  insertSpacedText,
  isPromptBusy,
  isPathMention,
  memoryRest,
  type SandboxDefaultState,
  type SandboxState,
} from "./prompt-input-utils"
import { sandboxMessages } from "./prompt-sandbox-messages"
import type { ExtensionMessage, ReviewCommentEntry, SendMessageFailedMessage, TextPart } from "../../types/messages"
import { formatReviewCommentsMarkdown } from "../../utils/review-comment-markdown"
import {
  createdDraftKey,
  failedPrompt,
  movePromptDraft,
  pendingDraftKey,
  promotePromptDraft,
  promptDraftKey,
  scopeDraftKey,
  sessionDraftKey,
} from "../../utils/prompt-drafts"
import {
  beginPendingSend,
  browserDrafts as references,
  clearPendingDraftDiscarded,
  clearSessionDraftDiscarded,
  drafts,
  finishPendingSend,
  imageDrafts,
  mentionDrafts,
  isPendingDraftDiscarded,
  isSessionDraftDiscarded,
  reviewDrafts,
  savePromptDraft,
  scrollDrafts,
} from "../../utils/draft-store"
import { ReviewComments } from "./ReviewComments"
import { BrowserReferences } from "./BrowserReferences"
import {
  browserFeedbackData,
  formatBrowserFeedback,
  mergeBrowserReferences,
  partFeedback,
  type BrowserReference,
} from "../../../../src/shared/browser-feedback"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { parseMemoryCommand, type ParsedMemoryCommand } from "../../utils/memory-command"
import { useMemory } from "../../context/memory"

function mergeReviewComments(current: ReviewCommentEntry[], incoming: ReviewCommentEntry[]): ReviewCommentEntry[] {
  if (incoming.length === 0) return current
  const map = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return [...map.values()]
}

function finishPending(id: string | undefined): boolean {
  if (!id) return false
  finishPendingSend(id)
  if (!isPendingDraftDiscarded(id)) return false
  clearPendingDraftDiscarded(id)
  return true
}

function beginPending(id: string | undefined) {
  if (id) beginPendingSend(id)
}

function readTerminalContext(read: (() => string | undefined) | undefined): string | undefined {
  return read?.()
}

interface PromptInputProps {
  blocked?: () => boolean
  edit?: { sessionID: string; messageID: string }
  onEditReady?: (ready: boolean) => void
  onEditComplete?: () => void
  /** When true, session is busy only because a suggestion is pending — treat as idle for input */
  suggesting?: () => boolean
  /** When true, session is busy only because a question is pending — treat as idle for input */
  questioning?: () => boolean
  /** When true, defer prompt focus while switching to a pending question */
  deferFocusToQuestion?: () => boolean
  worktree?: boolean
  onUpdateBase?: () => void
  boxId?: string
  terminalContext?: () => string | undefined
  worktrees?: () => WorktreeReference[]
  pendingSessionID?: string
  /** Agent Manager can suppress automatic prompt focus when this session last
   *  used its side terminal instead. Other callers retain the old behavior. */
  focusOnDraftChange?: () => boolean
  onFocusChange?: (focused: boolean) => void
  resolveEmbeddedTerminal?: (context?: string) => Promise<string | undefined>
}

function MentionItemContent(props: { item: MentionResult }) {
  const item = props.item
  const language = useLanguage()
  if (item.type === "terminal")
    return (
      <>
        <Icon name="console" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  if (item.type === "git-changes" || item.type === "worktrees")
    return (
      <>
        <Icon name="branch" class="file-mention-icon" />
        <span class="file-mention-name">
          {item.type === "worktrees" ? language.t("prompt.worktrees.title") : item.label}
        </span>
        <span class="file-mention-dir">
          {item.type === "worktrees" ? language.t("prompt.worktrees.search") : item.description}
        </span>
      </>
    )
  if (item.type === "past-chats")
    return (
      <>
        <Icon name="history" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  if (item.type === "session")
    return (
      <>
        <Icon name="history" class="file-mention-icon" />
        <span class="file-mention-name">{item.session.title}</span>
        <span class="file-mention-dir">
          {item.session.worktreeName ?? formatRelativeDate(new Date(item.session.updated).toISOString())}
        </span>
      </>
    )
  if (item.type === "file-picker")
    return (
      <>
        <Icon name="folder" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  return (
    <>
      <FileIcon
        node={{ path: item.value, type: item.type === "folder" ? "directory" : "file" }}
        class="file-mention-icon"
      />
      <span class="file-mention-name">
        {item.type === "folder" ? `${fileName(item.value)}/` : fileName(item.value)}
      </span>
      <span class="file-mention-dir">{dirName(item.value)}</span>
    </>
  )
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const session = useSession()
  const tabs = useLocalTabs()
  const server = useServer()
  const indexing = useIndexing()
  const { config, globalConfig, settings, features } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  const projectMemory = useMemory()
  const sid = () => session.currentSessionID() ?? props.pendingSessionID ?? session.draftSessionID() ?? undefined
  const ctx = () => {
    const id = props.boxId
    if (!id || !id.startsWith("agent-manager:")) return undefined
    const rest = id.slice("agent-manager:".length)
    return rest === "unassigned" ? undefined : rest
  }
  const hasGit = () => server.gitInstalled()
  const mention = useFileMention(vscode, sid, hasGit, props.worktrees)
  const terminal = useTerminalContext(props.resolveEmbeddedTerminal)
  const git = useGitChangesContext(vscode, ctx, hasGit)
  const imageAttach = useImageAttachments()
  imageAttach.setFilePathDropHandler((paths) => {
    if (readonly()) return
    const cwd = server.workspaceDirectory()
    const resolved = paths.map((p) => convertToMentionPath(p, cwd))
    const ref = textareaRef
    if (!ref) return
    const result = insertPathMentions(ref.value, ref.selectionStart ?? ref.value.length, resolved)
    ref.value = result.text
    setText(result.text)
    mention.addPaths(resolved, cwd)
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
    adjustHeight()
  })
  const history = usePromptHistory()
  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let slashDropdownRef: HTMLDivElement | undefined

  /**
   * True after the last menu entry of a bare `@`, which lists the entries above
   * the files. A query ranks entries among the results it finds, so there is no
   * group boundary left to draw.
   */
  const divides = (index: number) => {
    if (mention.mentionQuery()) return false
    const items = mention.mentionResults()
    const item = items.at(index)
    const next = items.at(index + 1)
    return item !== undefined && next !== undefined && isMentionEntry(item) && !isMentionEntry(next)
  }

  const boxKey = () => props.boxId ?? "prompt:default"
  const blockedHelpId = () => `${boxKey().replace(/[^a-zA-Z0-9_-]/g, "-")}-blocked-help`
  const rawKey = () =>
    sessionDraftKey(session.currentSessionID()) ??
    pendingDraftKey(props.pendingSessionID ?? session.draftSessionID()) ??
    "new"
  const draftKey = () => scopeDraftKey(boxKey(), rawKey())
  const goal = useGoalComposer(draftKey, {
    send: (...args) => session.sendCommand(...args),
    fingerprint: (key) => fingerprint(key),
    clear: (key) => clearDraft(key),
  })
  const fingerprint = (key: string) =>
    JSON.stringify(
      key === draftKey()
        ? [text().trim(), reviewComments(), imageAttach.images(), browsers()]
        : [
            (drafts.get(key) ?? "").trim(),
            reviewDrafts.get(key) ?? [],
            imageDrafts.get(key) ?? [],
            references.get(key) ?? [],
          ],
    )
  const locked = () => !!props.edit && props.edit.sessionID === session.currentSessionID()
  const readonly = () => locked() || (goal.active() && goal.pending())
  // Host-supplied drafts and attachments must wait, not disappear during Goal admission.
  const deferred = new Map<string, ((key: string) => void)[]>()
  let flushing = false
  const defer = (key: string, work: (key: string) => void) => {
    if (flushing || !goal.pending(key)) return false
    deferred.set(key, [...(deferred.get(key) ?? []), work])
    return true
  }
  createEffect(() => {
    const key = draftKey()
    if (goal.pending(key)) return
    queueMicrotask(() => {
      if (draftKey() !== key || goal.pending(key)) return
      const work = deferred.get(key)
      deferred.delete(key)
      work?.forEach((apply) => apply(key))
    })
  })
  const saveDraft = (
    key: string,
    next: string,
    comments: ReviewCommentEntry[],
    imgs: ImageAttachment[],
    scroll = textareaRef?.scrollTop ?? scrollDrafts.get(key) ?? 0,
    browser: BrowserReference[] = browsers(),
  ) => savePromptDraft(key, next, comments, imgs, scroll, browser)
  const readDraft = () => ({
    text: text().trim(),
    comments: reviewComments(),
    images: imageAttach.images(),
    browsers: browsers(),
    scroll: textareaRef?.scrollTop ?? scrollDrafts.get(draftKey()) ?? 0,
  })

  const [text, setText] = createSignal("")
  const [reviewComments, setReviewComments] = createSignal<ReviewCommentEntry[]>([])
  const [browsers, setBrowsers] = createSignal<BrowserReference[]>([])
  const [enhancing, setEnhancing] = createSignal(false)
  const [autoApprove, setAutoApprove] = createSignal(false)
  const [sandboxes, setSandboxes] = createSignal<Record<string, SandboxState>>({})
  const [sandboxDefault, setSandboxDefault] = createSignal<SandboxDefaultState>()
  const [sandboxRequests, setSandboxRequests] = createSignal<Record<string, string>>({})
  let sandboxRetry: ReturnType<typeof setTimeout> | undefined
  let sandboxAttempts = 0
  const sandboxID = () => {
    const id = session.currentSessionID()
    return id?.startsWith("cloud:") ? undefined : id
  }
  const sandboxVisible = () =>
    features().sandboxControls &&
    globalConfig().sandbox?.enabled === true &&
    !session.currentSessionID()?.startsWith("cloud:")
  const sandbox = () => {
    const id = sandboxID()
    return id ? sandboxes()[id] : undefined
  }
  const sandboxEnabled = () => (sandboxID() ? sandbox()?.enabled : sandboxDefault()?.enabled) ?? false
  const sandboxAvailable = () => (sandboxID() ? sandbox()?.available : sandboxDefault()?.available) ?? false
  const sandboxReason = () => (sandboxID() ? sandbox()?.reason : sandboxDefault()?.reason)
  const sandboxReady = () => (sandboxID() ? sandbox() !== undefined : sandboxDefault() !== undefined)
  const sandboxNetworkEnabled = () => config().sandbox?.network !== "allow"
  const sandboxRequest = (sessionID?: string) => sandboxRequests()[sessionID ?? ""]
  const sandboxDisabled = () =>
    !server.isConnected() || !sandboxReady() || !sandboxAvailable() || sandboxRequest(sandboxID()) !== undefined
  const requestSandbox = () => {
    if (server.connectionState() !== "connected") return
    const sessionID = sandboxID()
    if (sessionID) {
      vscode.postMessage({ type: "requestSandboxStatus", sessionID })
      return
    }
    vscode.postMessage({ type: "requestSandboxDefault", agentManagerContext: ctx() })
  }
  const toggleSandbox = () => {
    const sessionID = sandboxID()
    if (!sandboxVisible() || sandboxDisabled()) return
    const requestID = crypto.randomUUID()
    if (!sessionID) saveDraft(draftKey(), text(), reviewComments(), imageAttach.images())
    setSandboxRequests((current) => ({ ...current, [sessionID ?? ""]: requestID }))
    if (!sessionID) {
      vscode.postMessage({
        type: "setSandboxDefault",
        enabled: !sandboxDefault()!.desired,
        requestID,
        agentManagerContext: ctx(),
      })
      return
    }
    vscode.postMessage({
      type: "toggleSandbox",
      sessionID,
      requestID,
      agentManagerContext: ctx(),
    })
  }
  const slash = useSlashCommand(
    vscode,
    { action: toggleSandbox, enabled: () => sandboxVisible() && !sandboxDisabled() },
    () => {
      const hidden = new Set<string>()
      if (session.variantList(sid()).length === 0) hidden.add("variant")
      if (!sandboxVisible()) hidden.add("sandbox")
      if (props.worktree !== true) hidden.add("review worktree")
      if (!props.onUpdateBase || props.worktree !== true) hidden.add("update-from-base")
      return hidden
    },
    undefined,
    undefined,
    [
      {
        name: "goal",
        description: language.t("prompt.goal.set"),
        hints: [],
        select: () => {
          goal.activate()
          ghost.dismiss()
          textareaRef?.focus()
        },
      },
      {
        name: "update-from-base",
        description: "Ask the worktree agent to fetch and merge its saved base branch",
        hints: [],
        action: () => props.onUpdateBase?.(),
        enabled: () => props.worktree === true && server.isConnected() && !locked() && !props.blocked?.(),
      },
    ],
  )
  const clearSandboxRequest = (sessionID: string | undefined, requestID: string) => {
    setSandboxRequests((current) => {
      const key = sessionID ?? ""
      if (current[key] !== requestID) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const retrySandbox = (sessionID: string) => {
    if (sandboxAttempts >= 2) return
    sandboxAttempts++
    if (sandboxRetry) clearTimeout(sandboxRetry)
    sandboxRetry = setTimeout(() => {
      sandboxRetry = undefined
      if (sandboxID() === sessionID) requestSandbox()
    }, 1000)
  }
  let enhanceCounter = 0
  let preEnhanceText: string | null = null

  createEffect(() => {
    const sessionID = sandboxID()
    const connected = server.connectionState() === "connected"
    if (sandboxRetry) clearTimeout(sandboxRetry)
    sandboxRetry = undefined
    sandboxAttempts = 0
    if (!connected) {
      setSandboxRequests({})
      setSandboxes({})
      setSandboxDefault(undefined)
      return
    }
    if (!sessionID) {
      if (sandboxRequest(undefined)) return
      requestSandbox()
      return
    }
    requestSandbox()
  })

  const ghost = useGhostText(vscode, text, () => server.isConnected())
  const speech = useSpeechToText(vscode, server, language)
  const speechModels = useSpeechToTextModels()

  const replaceReviewComments = (next: ReviewCommentEntry[]) => {
    setReviewComments(next)
    if (next.length === 0) {
      reviewDrafts.delete(draftKey())
      return
    }
    reviewDrafts.set(draftKey(), next)
  }

  const clearReviewComments = () => replaceReviewComments([])

  const replace = (next: BrowserReference[]) => {
    setBrowsers(next)
    if (next.length === 0) {
      references.delete(draftKey())
      return
    }
    references.set(draftKey(), next)
  }

  const remove = (id: string) => {
    if (!readonly()) replace(browsers().filter((item) => item.id !== id))
  }
  const clear = () => replace([])

  const removeReviewComment = (id: string) => {
    if (readonly()) return
    replaceReviewComments(reviewComments().filter((item) => item.id !== id))
  }

  // Save/restore input text when switching sessions.
  // Uses `on()` to track only draftKey — avoids re-running on every keystroke.
  createEffect(
    on(draftKey, (key, prev) => {
      if (prev !== undefined && prev !== key) {
        const val = untrack(text)
        const comments = untrack(reviewComments)
        const imgs = untrack(imageAttach.images)
        const browser = untrack(browsers)
        if (val || comments.length > 0 || imgs.length > 0 || browser.length > 0 || drafts.has(prev)) {
          saveDraft(prev, val, comments, imgs, undefined, browser)
        }
      }
      const draft = drafts.get(key) ?? ""
      const pending = reviewDrafts.get(key) ?? []
      const scroll = scrollDrafts.get(key) ?? 0
      setText(draft)
      mention.seedFromText(draft)
      const refs = mentionDrafts.get(key)
      if (refs) {
        mention.seedFromParts(refs.paths, draft)
        mention.seedSessions(refs.sessions, draft)
      }
      setReviewComments(pending)
      setBrowsers(references.get(key) ?? [])
      imageAttach.replace(imageDrafts.get(key) ?? [])
      setEnhancing(false)
      preEnhanceText = null
      history.reset()
      if (textareaRef) {
        textareaRef.value = draft
        // Reset height then adjust
        textareaRef.style.height = "auto"
        textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
        textareaRef.scrollTop = scroll
        if (highlightRef) highlightRef.scrollTop = scroll
      }
      if (!props.deferFocusToQuestion?.() && (props.focusOnDraftChange?.() ?? true)) {
        window.dispatchEvent(new Event("focusPrompt"))
      }
    }),
  )

  // Seed prompt history from the current session's user messages (e.g., when a
  // session is loaded that has existing conversation). Tracks userMessages()
  // reactively so newly loaded sessions automatically contribute to history.
  // Strip review-comment markdown prefix so only the user's draft is stored.
  const REVIEW_PREFIX = /^## Review Comments\n[\s\S]*?\n\n/
  createEffect(() => {
    const msgs = session.userMessages()
    if (msgs.length === 0) return
    const timer = setTimeout(() => {
      const texts = msgs.map((m) => {
        const parts = session.getParts(m.id)
        return parts
          .filter((part): part is TextPart => part.type === "text")
          .map((part) => partFeedback(part.metadata, part.text)?.body ?? part.text.replace(REVIEW_PREFIX, ""))
          .join("")
      })
      history.seed(texts)
    }, 100)
    onCleanup(() => clearTimeout(timer))
  })

  // Focus textarea when any part of the app requests it
  const onFocusPrompt = (event: Event) => {
    const defer = () =>
      event instanceof CustomEvent && event.detail?.deferFocusToQuestion && props.deferFocusToQuestion?.()
    const ownsFocus = () => {
      const active = document.activeElement
      return hasPopup() || (active !== textareaRef && isTextControl(active))
    }
    const focus = () => {
      if (defer() || ownsFocus()) return
      const ref = textareaRef
      if (!ref) return
      ref.focus({ preventScroll: true })
    }
    focus()
    if (!(event instanceof CustomEvent) || !event.detail?.restore) return
    const restore = () => {
      if (defer() || ownsFocus()) return
      window.focus()
      focus()
    }
    queueMicrotask(restore)
    requestAnimationFrame(() => {
      restore()
      requestAnimationFrame(restore)
      setTimeout(restore, 0)
      setTimeout(restore, 50)
    })
  }
  window.addEventListener("focusPrompt", onFocusPrompt)
  onCleanup(() => window.removeEventListener("focusPrompt", onFocusPrompt))

  // Start a new task, carrying over the current prompt text (without auto-sending it)
  const onNewTaskRequest = () => {
    const draft = text().trim()
    const comments = reviewComments()
    const imgs = imageAttach.images()
    const browser = browsers()
    const scroll = textareaRef?.scrollTop ?? 0
    const id = tabs?.add()
    if (!id) session.clearCurrentSession()
    const key = id ? scopeDraftKey(boxKey(), pendingDraftKey(id) ?? "new") : draftKey()
    saveDraft(key, draft, comments, imgs, scroll, browser)
  }
  window.addEventListener("newTaskRequest", onNewTaskRequest)
  onCleanup(() => window.removeEventListener("newTaskRequest", onNewTaskRequest))

  const captured = new Map<string, ReturnType<typeof readDraft>>()
  const onAgentManagerCaptureDraft = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail?.id !== "string") return
    captured.set(event.detail.id, readDraft())
  }
  window.addEventListener("agentManagerCaptureDraft", onAgentManagerCaptureDraft)
  onCleanup(() => window.removeEventListener("agentManagerCaptureDraft", onAgentManagerCaptureDraft))

  const onAgentManagerApplyDraft = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const id = event.detail?.id
    const sid = event.detail?.sessionId
    const box = event.detail?.boxId
    if (typeof id !== "string" || typeof sid !== "string" || typeof box !== "string") return
    const draft = captured.get(id)
    captured.delete(id)
    if (!draft) return
    saveDraft(
      scopeDraftKey(box, sessionDraftKey(sid)),
      draft.text,
      draft.comments,
      draft.images,
      draft.scroll,
      draft.browsers,
    )
  }
  window.addEventListener("agentManagerApplyDraft", onAgentManagerApplyDraft)
  onCleanup(() => window.removeEventListener("agentManagerApplyDraft", onAgentManagerApplyDraft))

  const onAgentManagerDiscardDraft = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail?.id !== "string") return
    captured.delete(event.detail.id)
  }
  window.addEventListener("agentManagerDiscardDraft", onAgentManagerDiscardDraft)
  onCleanup(() => window.removeEventListener("agentManagerDiscardDraft", onAgentManagerDiscardDraft))

  // Compact/summarize the current session (mirrors canCompact guards in TaskHeader)
  const onCompact = () => {
    if (session.status() === "busy") return
    if (session.messages().length === 0) return
    if (!session.selected(sid())) return
    session.compact()
  }
  window.addEventListener("compactSession", onCompact)
  onCleanup(() => window.removeEventListener("compactSession", onCompact))

  const onExport = () => {
    const id = session.currentSessionID()
    if (id) session.exportSessionTranscript(id)
  }
  window.addEventListener("exportSessionTranscript", onExport)
  onCleanup(() => window.removeEventListener("exportSessionTranscript", onExport))

  const isBusy = () =>
    isPromptBusy(session.status(), !!props.suggesting?.(), !!props.questioning?.(), session.submitting())
  const showIndexing = () =>
    indexingButtonVisible(
      features().indexing,
      Boolean(settings()["indexing.showButtonWhenDisabled"] ?? true),
      config(),
      globalConfig(),
    )
  const isDisabled = () => !server.isConnected() || locked() || goal.pending()
  const canUseSpeech = () => canUseSpeechToText(config(), provider.authStates())
  const speechModel = () => selectedSpeechToTextModel(config(), speechModels.models())
  const hasInput = () =>
    text().trim().length > 0 || imageAttach.images().length > 0 || reviewComments().length > 0 || browsers().length > 0
  const sendReady = () => !isDisabled() && goalReady() && !terminal.pending() && !git.pending() && !props.blocked?.()
  const canContinue = () => !goal.active() && speech.state() === "idle" && !hasInput() && session.canResume()
  const goalReady = () => !goal.pending() && (!goal.active() || (!enhancing() && !imageAttach.pending()))
  const canSend = () =>
    sendReady() &&
    (speech.state() === "recording" ||
      (!speech.active() && (goal.active() ? goal.ready(text()) : hasInput() || canContinue())))
  const canSendContinue = () => sendReady() && !speech.active() && canContinue()
  const sendLabel = () => {
    if (props.blocked?.()) return language.t("prompt.action.send.blocked")
    if (speech.state() === "recording") return language.t("prompt.action.send.recording")
    if (goal.active()) return language.t("prompt.goal.start")
    if (canSendContinue()) return language.t("prompt.action.continue")
    return language.t("prompt.action.send")
  }
  const showStop = () =>
    !goal.active() &&
    (isBusy() || session.currentSession()?.goal?.active) &&
    !hasInput() &&
    speech.state() !== "recording"
  const isAtEnd = () =>
    textareaRef ? atEnd(textareaRef.selectionStart, textareaRef.selectionEnd, textareaRef.value.length) : false
  const highlightMentions = () => {
    const paths = new Set(mention.mentionedPaths())
    for (const token of mention.mentionedSessions().keys()) paths.add(token)
    if (hasTerminalMention(text())) paths.add("terminal")
    if (hasGit() && hasGitChangesMention(text())) paths.add("git-changes")
    return paths
  }
  const placeholder = () => {
    switch (server.connectionState()) {
      case "connecting":
        return language.t("prompt.placeholder.connecting")
      case "error":
        return language.t("prompt.placeholder.error")
      default:
        return language.t("prompt.placeholder.default")
    }
  }

  const canEdit = () =>
    server.isConnected() && !hasInput() && !enhancing() && !speech.active() && !terminal.pending() && !git.pending()
  createEffect(() => props.onEditReady?.(canEdit()))

  const edit = async (request: NonNullable<PromptInputProps["edit"]>) => {
    try {
      if (!canEdit() || request.sessionID !== session.currentSessionID()) return
      const parts = session.getParts(request.messageID)
      if (
        parts.some(
          (part) =>
            part.type !== "text" &&
            (part.type !== "file" ||
              (!part.source && !(part.mime.startsWith("image/") && part.url.startsWith("data:")))),
        )
      )
        return
      const state = revertPromptState(parts)
      if (!state.text.trim() && state.images.length === 0) return
      const key = draftKey()
      mention.closeMention()
      slash.close()
      ghost.dismiss()
      if (!(await session.deleteQueuedMessage(request.sessionID, request.messageID))) return
      if (!session.sessions().some((item) => item.id === request.sessionID)) return
      const active = draftKey() === key && textareaRef?.isConnected
      const value = [state.text, active ? text() : drafts.get(key)].filter(Boolean).join("\n\n")
      const images = [
        ...state.images.map((image) => ({ ...image, id: crypto.randomUUID(), filename: image.filename ?? "image" })),
        ...(active ? imageAttach.images() : (imageDrafts.get(key) ?? [])),
      ]
      const comments = active ? reviewComments() : (reviewDrafts.get(key) ?? [])
      savePromptDraft(key, value, comments, images)
      mentionDrafts.set(key, { paths: state.paths, sessions: state.sessions })
      if (!active) return
      enhanceCounter++
      preEnhanceText = null
      history.reset()
      setText(value)
      mention.seedFromParts(state.paths, value)
      mention.seedSessions(state.sessions, value)
      replaceReviewComments(comments)
      imageAttach.replace(images)
      adjustHeight()
      textareaRef?.focus()
      textareaRef?.setSelectionRange(value.length, value.length)
    } finally {
      props.onEditComplete?.()
    }
  }
  createEffect(
    on(
      () => props.edit,
      (request) => {
        if (request) void edit(request)
      },
    ),
  )

  const unsubAutoApprove = vscode.onMessage((message) => {
    if (message.type === "autoApproveState") {
      setAutoApprove(message.active)
    }
  })

  const restoreFailed = (failed: SendMessageFailedMessage) => {
    const restored = failedPrompt(failed)
    if (!restored) return
    const draft = restored.text
    if (
      (failed.draftID && isPendingDraftDiscarded(failed.draftID)) ||
      (failed.sessionID && isSessionDraftDiscarded(failed.sessionID))
    ) {
      if (failed.draftID) clearPendingDraftDiscarded(failed.draftID)
      if (failed.sessionID) clearSessionDraftDiscarded(failed.sessionID)
      return
    }
    if (failed.sessionID && !session.sessions().some((item) => item.id === failed.sessionID)) return
    const target = failed.sessionID
      ? scopeDraftKey(boxKey(), sessionDraftKey(failed.sessionID))
      : failed.draftID
        ? scopeDraftKey(boxKey(), pendingDraftKey(failed.draftID))
        : !session.currentSessionID() && !session.draftSessionID() && !session.userClearedSession()
          ? scopeDraftKey(boxKey(), "new")
          : undefined
    if (!target) return
    const comments = restored.comments
    const browser = restored.browsers
    const images = (failed.files ?? [])
      .filter((file) => file.mime.startsWith("image/") && file.url.startsWith("data:"))
      .map((file) => ({
        id: crypto.randomUUID(),
        filename: file.filename ?? "image",
        mime: file.mime,
        dataUrl: file.url,
      }))
    if (target !== draftKey()) {
      saveDraft(target, draft, comments, images, scrollDrafts.get(target) ?? 0, browser)
      return
    }
    // Do not overwrite a new draft the user started while the send was in flight.
    if (text().trim() || reviewComments().length > 0 || imageAttach.images().length > 0 || browsers().length > 0) return
    replaceReviewComments(comments)
    replace(browser)
    if (draft) {
      setText(draft)
      mention.seedFromText(draft)
      if (textareaRef) {
        textareaRef.value = draft
        adjustHeight()
        textareaRef.focus()
      }
    }
    if (images.length === 0) return
    imageAttach.replace(images)
    imageDrafts.set(target, images)
  }

  const handleSandboxMessage = sandboxMessages({
    connected: server.isConnected,
    session: sandboxID,
    pending: sandboxRequest,
    clear: clearSandboxRequest,
    defaults: sandboxDefault,
    setDefault: setSandboxDefault,
    states: sandboxes,
    setStates: setSandboxes,
    reset: () => {
      sandboxAttempts = 0
      if (sandboxRetry) clearTimeout(sandboxRetry)
      sandboxRetry = undefined
    },
    retry: retrySandbox,
    refresh: requestSandbox,
    error: (reason) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: reason,
      }),
  })

  const restoreBox = (message: Extract<ExtensionMessage, { type: "setChatBoxMessage" }>, key = draftKey()) => {
    if (defer(key, (key) => restoreBox(message, key))) return
    if (key !== draftKey()) {
      savePromptDraft(
        key,
        message.text,
        message.review ?? reviewDrafts.get(key) ?? [],
        message.images?.map((image) => ({ ...image, id: crypto.randomUUID(), filename: image.filename ?? "image" })) ??
          imageDrafts.get(key) ??
          [],
        scrollDrafts.get(key),
        message.browser ?? references.get(key) ?? [],
      )
      if (message.paths || message.sessions)
        mentionDrafts.set(key, { paths: message.paths ?? [], sessions: message.sessions ?? [] })
      return
    }
    setText(message.text)
    if (message.paths?.length) mention.seedFromParts(message.paths, message.text)
    else mention.seedFromText(message.text)
    if (message.sessions?.length) mention.seedSessions(message.sessions, message.text)
    if (textareaRef) {
      textareaRef.value = message.text
      adjustHeight()
    }
    if (message.review || message.browser) {
      replaceReviewComments(message.review ?? [])
      replace(message.browser ?? [])
    }
    if (message.images) {
      const imgs = message.images.map((img) => ({
        id: crypto.randomUUID(),
        filename: img.filename ?? "image",
        mime: img.mime,
        dataUrl: img.dataUrl,
      }))
      imageAttach.replace(imgs)
      imageDrafts.set(draftKey(), imgs)
    }
  }

  const appendBox = (message: Extract<ExtensionMessage, { type: "appendChatBoxMessage" }>, key = draftKey()) => {
    if (defer(key, (key) => appendBox(message, key))) return
    if (key !== draftKey()) {
      if (message.browser) {
        references.set(key, mergeBrowserReferences(references.get(key) ?? [], message.browser))
        return
      }
      const current = drafts.get(key) ?? ""
      drafts.set(key, current + (current && !current.endsWith("\n") ? "\n\n" : "") + message.text)
      return
    }
    const reference = message.browser
    if (reference) {
      if (reference.sessionId !== sid()) return
      replace(mergeBrowserReferences(browsers(), reference))
      textareaRef?.focus()
      return
    }
    const current = text()
    const separator = current && !current.endsWith("\n") ? "\n\n" : ""
    const next = current + separator + message.text
    setText(next)
    if (textareaRef) {
      textareaRef.value = next
      adjustHeight()
      textareaRef.focus()
      textareaRef.scrollTop = textareaRef.scrollHeight
      syncHighlightScroll()
    }
  }

  const appendReviews = (message: Extract<ExtensionMessage, { type: "appendReviewComments" }>, key?: string) => {
    const target =
      key ??
      (message.sessionID
        ? promptDraftKey(boxKey(), message.sessionID, {
            draft: props.pendingSessionID ?? session.draftSessionID(),
            current: session.currentSessionID(),
          })
        : draftKey())
    if (!target) return
    if (defer(target, (key) => appendReviews(message, key))) return
    if (target !== draftKey()) {
      reviewDrafts.set(target, mergeReviewComments(reviewDrafts.get(target) ?? [], message.comments))
      return
    }
    const empty =
      !text().trim() && reviewComments().length === 0 && imageAttach.images().length === 0 && browsers().length === 0
    replaceReviewComments(mergeReviewComments(reviewComments(), message.comments))
    if (message.autoSend && empty && !isDisabled() && !props.blocked?.()) {
      void handleSend()
      return
    }
    textareaRef?.focus()
  }

  const created = (message: Extract<ExtensionMessage, { type: "sessionCreated" }>) => {
    const raw = createdDraftKey(message.draftID, sandboxRequest(undefined) !== undefined)
    if (!raw) return
    const source = scopeDraftKey(boxKey(), raw)
    const target = scopeDraftKey(boxKey(), sessionDraftKey(message.session.id))
    goal.move(source, target)
    const queued = deferred.get(source)
    if (queued) {
      deferred.set(target, [...queued, ...(deferred.get(target) ?? [])])
      deferred.delete(source)
    }
    if (source === draftKey()) saveDraft(source, text(), reviewComments(), imageAttach.images())
    const from = reviewDrafts.get(source)
    const to = reviewDrafts.get(target)
    if (from && to) {
      reviewDrafts.set(target, mergeReviewComments(from, to))
      reviewDrafts.delete(source)
    }
    movePromptDraft(
      { text: drafts, comments: reviewDrafts, images: imageDrafts, scrolls: scrollDrafts, browsers: references },
      source,
      target,
    )
    if (message.draftID) promotePromptDraft(boxKey(), message.draftID, message.session.id)
    if (
      message.draftID &&
      !session.currentSessionID() &&
      (props.pendingSessionID ?? session.draftSessionID()) === message.draftID
    ) {
      session.setDraftSessionID(message.session.id)
    }
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (handleSandboxMessage(message)) return

    if (message.type === "setChatBoxMessage") {
      restoreBox(message)
    }

    if (message.type === "appendChatBoxMessage") appendBox(message)

    if (message.type === "appendReviewComments") appendReviews(message)

    if (message.type === "triggerTask") {
      if (isDisabled()) return
      const sel = session.selected(sid())
      session.sendMessage(message.text, sel?.providerID, sel?.modelID, undefined, undefined, ctx())
    }

    if (message.type === "sendMessageFailed") {
      if (message.messageID && goal.finish(message.messageID, false)) {
        return
      }
      restoreFailed(message as SendMessageFailedMessage)
    }

    if (message.type === "sessionCommandCompleted") {
      goal.finish(message.messageID, true)
    }

    if (message.type === "sessionCreated") created(message)

    if (message.type === "action" && message.action === "focusInput") {
      textareaRef?.focus()
    }

    if (message.type === "enhancePromptResult") {
      const result = message as import("../../types/messages").EnhancePromptResultMessage
      if (result.requestId === `enhance-${draftKey()}-${enhanceCounter}`) {
        setText(result.text)
        mention.seedFromText(result.text)
        setEnhancing(false)
        if (textareaRef) {
          textareaRef.value = result.text
          adjustHeight()
          textareaRef.focus()
        }
      }
    }

    if (message.type === "enhancePromptError") {
      const result = message as import("../../types/messages").EnhancePromptErrorMessage
      if (result.requestId === `enhance-${draftKey()}-${enhanceCounter}`) {
        setEnhancing(false)
      }
    }

    if (message.type === "filePickerResult") {
      if (defer(draftKey(), () => mention.insertFilePickerResult(message.path, message.requestId))) return
      mention.insertFilePickerResult(message.path, message.requestId)
    }
  })
  vscode.postMessage({ type: "requestAutoApproveState" })

  onCleanup(() => {
    props.onEditReady?.(false)
    // Keep delayed host input in its draft even if the composer unmounts before acknowledgement.
    flushing = true
    for (const [key, work] of deferred) work.forEach((apply) => apply(key))
    deferred.clear()
    // Persist current draft before unmounting
    saveDraft(draftKey(), text(), reviewComments(), imageAttach.images())
    if (sandboxRetry) clearTimeout(sandboxRetry)
    unsubAutoApprove()
    unsubscribe()
  })

  const acceptSuggestion = () => {
    if (readonly()) return
    const result = ghost.accept()
    if (!result) return

    const val = text() + result.text
    setText(val)

    if (textareaRef) {
      textareaRef.value = val
      adjustHeight()
      syncHighlightScroll()
    }
  }

  const syncGhost = () => ghost.sync(textareaRef)

  const scrollToActiveItem = () => {
    if (!dropdownRef) return
    const items = dropdownRef.querySelectorAll(".file-mention-item")
    const active = items[mention.mentionIndex()] as HTMLElement | undefined
    if (active) active.scrollIntoView({ block: "nearest" })
  }

  const scrollToActiveSlashItem = () => {
    if (!slashDropdownRef) return
    const items = slashDropdownRef.querySelectorAll(".slash-command-item")
    const active = items[slash.index()] as HTMLElement | undefined
    if (active) active.scrollIntoView({ block: "nearest" })
  }

  const syncHighlightScroll = () => {
    if (!textareaRef) return
    scrollDrafts.set(draftKey(), textareaRef.scrollTop)
    if (highlightRef) highlightRef.scrollTop = textareaRef.scrollTop
  }

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const handlePaste = (e: ClipboardEvent) => {
    if (readonly()) {
      e.preventDefault()
      return
    }
    imageAttach.handlePaste(e)
    // After pasting text, the textarea content changes but the layout may not
    // have reflowed yet, causing the caret position to be visually out of sync.
    // Defer height recalculation to after the browser completes the reflow.
    requestAnimationFrame(() => {
      adjustHeight()
      syncHighlightScroll()
    })
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    if (readonly()) {
      target.value = text()
      return
    }
    const val = target.value
    setText(val)
    preEnhanceText = null
    adjustHeight()
    syncHighlightScroll()
    history.reset()

    if (!goal.active()) slash.onInput(val, target.selectionStart ?? val.length)
    mention.onInput(val, target.selectionStart ?? val.length)
    ghost.setMentionOpen(slash.show() || mention.showMention())
    ghost.scheduleRequest(val, textareaRef)
  }

  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return false
    if (hasPopup()) return true
    if (!ghost.text() && !goal.active() && !isBusy()) return false
    e.preventDefault()
    e.stopPropagation()
    if (ghost.text()) ghost.dismiss()
    else if (goal.active()) goal.cancel()
    else session.abort()
    return true
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (goal.pending()) {
      escape(e)
      return
    }
    if (locked()) return
    // Undo enhanced prompt with Ctrl+Z / ⌘Z
    if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && preEnhanceText !== null) {
      e.preventDefault()
      const restored = preEnhanceText
      preEnhanceText = null
      setText(restored)
      if (textareaRef) {
        textareaRef.value = restored
        adjustHeight()
      }
      return
    }

    // Atomic mention removal on backspace
    if (
      mention.handleBackspace(e, textareaRef, setText, () => {
        adjustHeight()
        syncHighlightScroll()
      })
    )
      return

    // Skip cursor over mentions on arrow keys
    if (mention.handleArrowKey(e, textareaRef)) return

    if (slash.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      ghost.setMentionOpen(slash.show())
      queueMicrotask(scrollToActiveSlashItem)
      return
    }

    if (mention.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      ghost.setMentionOpen(mention.showMention())
      queueMicrotask(scrollToActiveItem)
      return
    }

    // Prompt history: ArrowUp/ArrowDown at cursor boundaries cycles through sent prompts
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const start = textareaRef?.selectionStart ?? 0
      const end = textareaRef?.selectionEnd ?? 0
      if (start !== end) return // don't replace active text selection
      const cursor = start
      const direction = e.key === "ArrowUp" ? ("up" as const) : ("down" as const)
      const entry = history.navigate(direction, text(), cursor)
      if (entry !== null) {
        e.preventDefault()
        setText(entry)
        if (textareaRef) {
          textareaRef.value = entry
          adjustHeight()
          const pos = direction === "up" ? 0 : entry.length
          textareaRef.setSelectionRange(pos, pos)
        }
        return
      }
    }

    // Shift+Tab cycles reasoning effort variants (setting: chat.shiftTabCyclesVariant).
    // When disabled or no variants exist, fall through to default focus navigation.
    if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (settings()["chat.shiftTabCyclesVariant"] === false) return
      const list = session.variantList(sid())
      if (list.length === 0) return
      const next = cycleVariant(session.currentVariant(sid()), list)
      e.preventDefault()
      session.selectVariant(next, sid())
      return
    }

    if (e.key === "Tab" && !e.shiftKey && ghost.text()) {
      if (!isAtEnd()) return
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === "ArrowRight" && ghost.text()) {
      if (!isAtEnd()) return
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (escape(e)) return
    if (isEnterKeyCommitNotIme(e) && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const canEnhance = () => !isBusy() && !isDisabled() && !enhancing()

  const handleOpenIndexingSettings = () => {
    vscode.postMessage({ type: "openSettingsTab", tab: "indexing" })
  }

  const handleEnhance = () => {
    if (isDisabled() || enhancing() || isBusy()) return
    const draft = text().trim()
    if (!draft) {
      const description = language.t("prompt.action.enhanceDescription")
      setText(description)
      if (textareaRef) {
        textareaRef.value = description
        adjustHeight()
        textareaRef.focus()
      }
      return
    }
    preEnhanceText = text()
    enhanceCounter++
    setEnhancing(true)
    vscode.postMessage({ type: "enhancePrompt", text: draft, requestId: `enhance-${draftKey()}-${enhanceCounter}` })
  }

  const insertSpeechText = (value: string) => {
    const ref = textareaRef
    const current = text()
    const start = ref?.selectionStart ?? current.length
    const end = ref?.selectionEnd ?? start
    const result = insertSpacedText(current, value, start, end)

    setText(result.text)
    if (!ref) return
    ref.value = result.text
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
    adjustHeight()
    syncHighlightScroll()
    ghost.scheduleRequest(result.text, ref)
  }

  const startSpeech = () => {
    speech.start({ model: speechModel(), insert: insertSpeechText })
  }

  const transcribeAndSend = () => {
    const key = draftKey()
    const id = sid()
    const context = ctx()
    const value = text()
    const comments = reviewComments()
    const browser = browsers()
    const images = imageAttach.images()
    speech.stop({
      done: () => void handleSend(),
      ready: () =>
        draftKey() === key &&
        sid() === id &&
        ctx() === context &&
        text() === value &&
        reviewComments() === comments &&
        browsers() === browser &&
        imageAttach.images() === images,
    })
  }

  const shortcut = createSpeechShortcut({
    speech,
    disabled: () => !canUseSpeech() || isDisabled(),
    start: startSpeech,
    finish: (submit) => {
      if (submit) {
        transcribeAndSend()
        return
      }
      speech.stop()
    },
  })
  const speechDown = (e: KeyboardEvent): boolean => {
    if (!shortcut.down(e)) return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  const speechUp = (e: KeyboardEvent): boolean => {
    if (!shortcut.up(e)) return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  onCleanup(shortcut.reset)

  const handleSendClick = () => {
    if (speech.state() !== "recording" || !canSend()) {
      void handleSend()
      return
    }
    transcribeAndSend()
  }

  const runMemory = (memory: NonNullable<ReturnType<typeof parseMemoryCommand>>) => {
    if (memory.kind === "usage") {
      showToast({ variant: "error", title: language.t("chat.memory.command.failed"), description: memory.reason })
      return false
    }
    if (memory.kind === "help") {
      const value = "/memory "
      setText(value)
      if (textareaRef) {
        textareaRef.value = value
        textareaRef.setSelectionRange(value.length, value.length)
        textareaRef.focus()
      }
      slash.onInput(value, value.length)
      adjustHeight()
      return false
    }
    if (isDisabled() || speech.active() || terminal.pending() || git.pending() || props.blocked?.()) return false
    const status = projectMemory.status()
    if (
      memory.kind === "operation" &&
      (memory.operation === "remember" || memory.operation === "correct" || memory.operation === "forget") &&
      status &&
      !status.state.enabled
    ) {
      showToast({ variant: "error", title: language.t("chat.memory.project.disabled") })
      return false
    }
    if (memory.kind === "show") vscode.postMessage({ type: "memoryShow", mode: "show", sessionID: sid() })
    if (memory.kind === "operation") {
      if (memory.operation === "status") {
        vscode.postMessage({ type: "memoryShow", mode: "status", sessionID: sid() })
        return true
      }
      vscode.postMessage({
        type: "memoryOperation",
        operation: memory.operation,
        sessionID: sid(),
        ...(memory.operation === "auto" ? { mode: memory.mode } : {}),
        ...(memory.operation === "purge" ? { confirm: memory.confirm } : {}),
        ...(memory.operation === "remember" || memory.operation === "correct" ? { text: memory.text } : {}),
        ...(memory.operation === "forget" ? { query: memory.query } : {}),
      })
    }
    return true
  }

  const setMemoryText = (memory: ParsedMemoryCommand) => {
    const rest = memoryRest(memory)
    setText(rest)
    if (textareaRef) {
      textareaRef.value = rest
      textareaRef.setSelectionRange(0, 0)
      textareaRef.focus()
    }
  }

  const command = (draft: string) => {
    const match = draft.match(/^\/(\S+)/)
    const word = match?.[1]
    const entry = word
      ? (slash.commands().find((c) => c.name === word) ?? slash.commands().find((c) => c.hints.includes(word)))
      : undefined
    return { match, entry }
  }

  const handleSend = async () => {
    const draft = text().trim()
    if (
      !goal.prepare(draft, () => {
        setText("")
        slash.close()
        ghost.dismiss()
        adjustHeight()
      })
    )
      return
    const objective = goal.active()

    const memory = objective ? undefined : parseMemoryCommand(draft)
    if (memory) {
      if (!runMemory(memory)) return
      history.append(draft)
      setMemoryText(memory)
      clearReviewComments()
      clear()
      imageAttach.clear()
      mention.closeMention()
      slash.close()
      drafts.delete(draftKey())
      reviewDrafts.delete(draftKey())
      imageDrafts.delete(draftKey())
      mentionDrafts.delete(draftKey())
      scrollDrafts.delete(draftKey())
      if (textareaRef) textareaRef.style.height = "auto"
      return
    }

    // Detect slash command (hoisted for both client and server command checks).
    // Prioritize exact name matches over hint/alias matches so that a server
    // command named e.g. "continue" is not hijacked by a client alias.
    const parsed = command(objective ? "" : draft)
    const cmdMatch = parsed.match
    const matched = parsed.entry

    // Client-side slash command — runs locally without a backend round-trip
    if (matched?.action) {
      if (matched.enabled && !matched.enabled()) return
      setText("")
      clearReviewComments()
      clear()
      imageAttach.clear()
      mention.closeMention()
      slash.close()
      drafts.delete(draftKey())
      reviewDrafts.delete(draftKey())
      imageDrafts.delete(draftKey())
      mentionDrafts.delete(draftKey())
      scrollDrafts.delete(draftKey())
      if (textareaRef) textareaRef.style.height = "auto"
      matched.action()
      return
    }

    const imgs = imageAttach.images()
    const pending = reviewComments()
    const review = pending.length > 0 ? formatReviewCommentsMarkdown(pending) : ""
    const browserData = browserFeedbackData(browsers())
    const browserText = browserData ? formatBrowserFeedback(browserData.references) : ""
    const message = [review, browserText, draft].filter(Boolean).join("\n\n")
    if (canSendContinue()) {
      session.resume()
      return
    }
    const data = review ? { version: 1 as const, comments: pending } : undefined
    if ((!message && imgs.length === 0) || !sendReady() || speech.active()) return

    const mentionFiles = mention.parseFileAttachments(draft)
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl, filename: img.filename }))
    const origin = session.currentSessionID()
    const pendingId = props.pendingSessionID ?? (!origin ? session.draftSessionID() : undefined)
    const id = origin ?? pendingId
    beginPending(pendingId)
    const sel = session.selected(id)
    const context = ctx()
    const key = draftKey()
    const stamp = fingerprint(key)

    const terminalFile = await terminal
      .resolveAttachment(message, id, readTerminalContext(props.terminalContext))
      .catch((err: Error) => {
        showToast({ variant: "error", title: "Terminal context unavailable", description: err.message })
        return undefined
      })
    if (hasTerminalMention(message) && !terminalFile) {
      finishPending(pendingId)
      return
    }

    const gitFile = await git.resolveAttachment(message, id, context).catch((err: Error) => {
      showToast({ variant: "error", title: "Git changes unavailable", description: err.message })
      return undefined
    })
    if (hasGit() && hasGitChangesMention(message) && !gitFile) {
      finishPending(pendingId)
      return
    }
    if (isDisabled()) {
      finishPending(pendingId)
      return
    }
    if (finishPending(pendingId)) return

    const allFiles = [
      ...mentionFiles,
      ...imgFiles,
      ...(terminalFile ? [terminalFile] : []),
      ...(gitFile ? [gitFile] : []),
    ]
    const attachments = allFiles.length > 0 ? allFiles : undefined

    if (objective) {
      mention.closeMention()
      slash.close()
      ghost.dismiss()
      goal.send(key, stamp, [
        "goal",
        `-- ${message}`,
        sel?.providerID,
        sel?.modelID,
        attachments,
        pendingId,
        context,
        origin ?? null,
      ])
      return
    }

    // Server-side slash command (cmdMatch/matched already computed above)
    if (matched && !data && !browserData) {
      const args = draft.slice(cmdMatch![0].length).trim()
      const accepted = session.sendCommand(
        matched.name,
        args,
        sel?.providerID,
        sel?.modelID,
        attachments,
        pendingId,
        context,
        origin ?? null,
        {
          agent: matched.agent,
          model: matched.model,
          variant: matched.variant,
        },
      )
      if (!accepted) return
    } else {
      const accepted = session.sendMessage(
        message,
        sel?.providerID,
        sel?.modelID,
        attachments,
        pendingId,
        context,
        data,
        origin ?? null,
        browserData,
      )
      if (!accepted) return
    }

    clearDraft(key, draft)
  }

  const clearDraft = (key: string, value = key === draftKey() ? text().trim() : (drafts.get(key) ?? "").trim()) => {
    history.append(value)
    drafts.delete(key)
    reviewDrafts.delete(key)
    references.delete(key)
    imageDrafts.delete(key)
    mentionDrafts.delete(key)
    scrollDrafts.delete(key)
    if (draftKey() !== key) return

    history.reset()
    setText("")
    clearReviewComments()
    setBrowsers([])
    imageAttach.clear()
    mention.closeMention()
    slash.close()

    if (textareaRef) textareaRef.style.height = "auto"
  }

  return (
    <div
      class="prompt-input-container"
      classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
      onDragOver={imageAttach.handleDragOver}
      onDragLeave={imageAttach.handleDragLeave}
      onDrop={(event) => {
        if (readonly()) {
          event.preventDefault()
          return
        }
        imageAttach.handleDrop(event)
      }}
    >
      <Show when={goal.active()}>
        <GoalHeader
          onCancel={() => {
            goal.cancel()
            textareaRef?.focus()
          }}
        />
      </Show>
      <Show when={reviewComments().length > 0}>
        <ReviewComments
          comments={reviewComments()}
          sessionID={sid()}
          onRemove={removeReviewComment}
          onClear={(ids) => {
            if (!readonly()) replaceReviewComments(reviewComments().filter((item) => !ids.includes(item.id)))
          }}
        />
      </Show>
      <Show when={browsers().length > 0}>
        <div data-component="browser-references">
          <BrowserReferences
            references={browsers()}
            onRemove={remove}
            onClear={() => {
              if (!readonly()) clear()
            }}
          />
        </div>
      </Show>
      <Show when={mention.showMention()}>
        <div class="file-mention-dropdown" ref={dropdownRef}>
          <Show
            when={!mention.sessionPicker()}
            fallback={
              <SessionMentionPicker
                sessions={mention.sessionCandidates()}
                onSelect={(picked) => {
                  if (textareaRef) mention.selectSession(picked, textareaRef, setText, adjustHeight)
                }}
                onClose={() => {
                  mention.closeMention()
                  textareaRef?.focus()
                }}
              />
            }
          >
            <Show
              when={!mention.worktreePicker() && mention.mentionResults().length > 0}
              fallback={
                <Show
                  when={mention.worktreePicker()}
                  fallback={<div class="file-mention-empty">No files or folders found</div>}
                >
                  <WorktreeMentionPicker
                    worktrees={mention.worktreeCandidates()}
                    onSelect={(picked) => {
                      if (textareaRef) mention.selectWorktree(picked, textareaRef, setText, adjustHeight)
                    }}
                    onClose={() => {
                      mention.closeMention()
                      textareaRef?.focus()
                    }}
                  />
                </Show>
              }
            >
              <For each={mention.mentionResults()}>
                {(item, index) => (
                  <>
                    <div
                      class="file-mention-item"
                      data-type={item.type}
                      classList={{ "file-mention-item--active": index() === mention.mentionIndex() }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        if (textareaRef) mention.selectMention(item, textareaRef, setText, adjustHeight)
                      }}
                      onMouseEnter={() => mention.setMentionIndex(index())}
                    >
                      <MentionItemContent item={item} />
                    </div>
                    <Show when={divides(index())}>
                      <div class="file-mention-separator" />
                    </Show>
                  </>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={slash.show()}>
        <div class="slash-command-dropdown" ref={slashDropdownRef}>
          <Show when={slash.results().length > 0} fallback={<div class="slash-command-empty">No commands found</div>}>
            {(() => {
              const all = slash.results()
              const actions = all.filter((c) => c.action)
              const server = all.filter((c) => !c.action)
              const offset = actions.length
              return (
                <>
                  <Show when={actions.length > 0}>
                    <div class="slash-command-group-label">Actions</div>
                    <For each={actions}>
                      {(cmd, idx) => (
                        <div
                          class="slash-command-item"
                          classList={{ "slash-command-item--active": idx() === slash.index() }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (textareaRef) slash.select(cmd, textareaRef, setText, adjustHeight)
                          }}
                          onMouseEnter={() => slash.setIndex(idx())}
                        >
                          <span class="slash-command-name">/{cmd.name}</span>
                          <Show when={cmd.description}>
                            <span class="slash-command-desc">{cmd.description}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                  <Show when={server.length > 0}>
                    <Show when={actions.length > 0}>
                      <div class="slash-command-separator" />
                    </Show>
                    <div class="slash-command-group-label">Commands</div>
                    <For each={server}>
                      {(cmd, idx) => (
                        <div
                          class="slash-command-item"
                          classList={{ "slash-command-item--active": idx() + offset === slash.index() }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (textareaRef) slash.select(cmd, textareaRef, setText, adjustHeight)
                          }}
                          onMouseEnter={() => slash.setIndex(idx() + offset)}
                        >
                          <span class="slash-command-name">/{cmd.name}</span>
                          <Show when={cmd.description}>
                            <span class="slash-command-desc">{cmd.description}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </>
              )
            })()}
          </Show>
        </div>
      </Show>
      <Show when={imageAttach.images().length > 0}>
        <div class="image-attachments">
          <For each={imageAttach.images()}>
            {(img) => (
              <div class="image-attachment">
                <img
                  src={img.dataUrl}
                  alt={img.filename}
                  title={img.filename}
                  onClick={() =>
                    vscode.postMessage({ type: "previewImage", dataUrl: img.dataUrl, filename: img.filename })
                  }
                />
                <button
                  type="button"
                  class="image-attachment-remove"
                  disabled={readonly()}
                  onClick={() => {
                    if (!readonly()) imageAttach.remove(img.id)
                  }}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" ref={highlightRef} aria-hidden="true" dir="auto">
            <Index each={buildHighlightSegments(text(), highlightMentions())}>
              {(seg) => (
                <Show when={seg().highlight} fallback={<span>{seg().text}</span>}>
                  <span
                    class="prompt-input-file-mention"
                    classList={{ "prompt-input-file-mention--file": isPathMention(seg().text) }}
                    onClick={(e) => {
                      if (!isPathMention(seg().text)) return
                      if (mention.mentionedSessions().has(seg().text.replace(/^@/, ""))) return
                      e.preventDefault()
                      e.stopPropagation()
                      vscode.postMessage({ type: "openFile", filePath: seg().text.replace(/^@/, "") })
                    }}
                  >
                    {seg().text}
                  </span>
                </Show>
              )}
            </Index>
            <Show when={ghost.text()}>
              <span class="prompt-input-ghost-text">{ghost.text()}</span>
            </Show>
            {/* A <div> with white-space: pre-wrap collapses a trailing newline,
                but a <textarea> renders it as a real empty line. This <br> is
                added in that case so the overlay and textarea heights match. */}
            <Show when={text().endsWith("\n")}>
              <br />
            </Show>
          </div>
          <textarea
            ref={textareaRef}
            class="prompt-input"
            classList={{ "prompt-input--disabled": !server.isConnected() || readonly() }}
            placeholder={placeholder()}
            value={text()}
            onInput={handleInput}
            onKeyDown={(e) => {
              if (speechDown(e)) return
              const key = e.key.toLowerCase()
              if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === "z" || (key === "y" && !e.shiftKey))) {
                e.stopPropagation()
              }
              handleKeyDown(e)
            }}
            onKeyUp={(e) => {
              if (speechUp(e)) return
              syncGhost()
            }}
            onPaste={handlePaste}
            onClick={syncGhost}
            onFocus={() => {
              syncGhost()
              props.onFocusChange?.(true)
            }}
            onBlur={() => {
              syncGhost()
              props.onFocusChange?.(false)
            }}
            onSelect={() => {
              syncGhost()
              if (textareaRef) mention.snapSelection(textareaRef)
            }}
            onScroll={syncHighlightScroll}
            aria-disabled={!server.isConnected() || readonly()}
            readOnly={readonly()}
            rows={1}
            dir="auto"
          />
        </div>
      </div>
      <div class="prompt-input-hint">
        <div class="prompt-input-hint-selectors">
          <ModeSwitcher sessionID={sid} />
          <ModelSelector sessionID={sid} />
          <ThinkingSelector sessionID={sid} />
        </div>
        <div class="prompt-input-hint-actions">
          <Show when={showIndexing()}>
            <Tooltip value={indexing.status().message || indexing.label()} placement="top" openDelay={0}>
              <Button
                variant="ghost"
                size="small"
                onClick={handleOpenIndexingSettings}
                aria-label={language.t("prompt.action.indexing")}
                class={`prompt-indexing-button prompt-indexing-button--${indexing.tone()}`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <ellipse cx="8" cy="3.5" rx="4.5" ry="2" stroke="currentColor" stroke-width="1.2" />
                  <path
                    d="M3.5 3.5V12.5C3.5 13.6046 5.51472 14.5 8 14.5C10.4853 14.5 12.5 13.6046 12.5 12.5V3.5"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <path
                    d="M3.5 8C3.5 9.10457 5.51472 10 8 10C10.4853 10 12.5 9.10457 12.5 8"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <circle cx="13" cy="3" r="2.5" fill="currentColor" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
          <Tooltip
            value={
              autoApprove()
                ? language.t("prompt.action.autoApprove.enabled")
                : language.t("prompt.action.autoApprove.disabled")
            }
            placement="top"
            openDelay={0}
          >
            <Button
              variant="ghost"
              size="small"
              onClick={() => vscode.postMessage({ type: "toggleAutoApprove" })}
              aria-label={
                autoApprove()
                  ? language.t("prompt.action.autoApprove.disable")
                  : language.t("prompt.action.autoApprove.enable")
              }
              aria-pressed={autoApprove()}
              class={`prompt-status-button ${autoApprove() ? "prompt-status-button--active" : ""}`}
            >
              <Icon name="shield" size="small" />
            </Button>
          </Tooltip>
          <Show when={sandboxVisible()}>
            <SandboxButtonBase
              enabled={sandboxEnabled()}
              available={sandboxReady() ? sandboxAvailable() : undefined}
              reason={sandboxReason()}
              disabled={sandboxDisabled()}
              tooltip={<SandboxTooltipContent enabled={sandboxEnabled()} network={sandboxNetworkEnabled()} />}
              tooltipClass="prompt-sandbox-tooltip-content"
              onToggle={toggleSandbox}
            />
          </Show>
          <Tooltip value={language.t("prompt.action.enhance")} placement="top" openDelay={0}>
            <Button
              variant="ghost"
              size="small"
              onClick={handleEnhance}
              disabled={!canEnhance()}
              aria-label={language.t("prompt.action.enhance")}
            >
              <WandSparkles size={16} class={enhancing() ? "enhance-spinner" : ""} />
            </Button>
          </Tooltip>
          <Show when={canUseSpeech()}>
            <SpeechToTextButton speech={speech} disabled={isDisabled()} start={startSpeech} label={language.t} />
          </Show>
          <Show
            when={showStop()}
            fallback={
              <Tooltip value={sendLabel()} placement="top" openDelay={0}>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={handleSendClick}
                  aria-disabled={!canSend()}
                  aria-label={sendLabel()}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.5 1.5L14.5 8L1.5 14.5V9L10 8L1.5 7V1.5Z" />
                  </svg>
                  <Show when={goal.active()}>{language.t("prompt.goal.start")}</Show>
                </Button>
              </Tooltip>
            }
          >
            <Tooltip value={language.t("prompt.action.stop")} placement="top" openDelay={0}>
              <Button
                variant="ghost"
                size="small"
                onClick={() => session.abort()}
                aria-label={language.t("prompt.action.stop")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
        </div>
      </div>
    </div>
  )
}
