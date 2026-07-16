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
import { useSession } from "../../context/session"
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
import { useTerminalContext } from "../../hooks/useTerminalContext"
import { useGitChangesContext } from "../../hooks/useGitChangesContext"
import { hasTerminalMention } from "../../hooks/terminal-context-utils"
import { hasGitChangesMention } from "../../hooks/git-changes-context-utils"
import { useSlashCommand } from "../../hooks/useSlashCommand"
import { useGhostText } from "../../hooks/useGhostText"
import { useSpeechToText } from "../speech-to-text/useSpeechToText"
import { useImageAttachments, type ImageAttachment } from "../../hooks/useImageAttachments"
import { convertToMentionPath } from "../../utils/path-mentions"
import { usePromptHistory } from "../../hooks/usePromptHistory"
import { WandSparkles } from "@kilocode/kilo-ui/lucide"
import {
  fileName,
  dirName,
  buildHighlightSegments,
  atEnd,
  insertSpacedText,
  isPromptBusy,
  isPathMention,
  applySandboxStates,
  type SandboxDefaultState,
  type SandboxState,
} from "./prompt-input-utils"
import type { ExtensionMessage, ReviewComment, SendMessageFailedMessage, TextPart } from "../../types/messages"
import { formatReviewCommentsMarkdown } from "../../utils/review-comment-markdown"
import {
  createdDraftKey,
  movePromptDraft,
  pendingDraftKey,
  scopeDraftKey,
  sessionDraftKey,
} from "../../utils/prompt-drafts"
import {
  beginPendingSend,
  clearPendingDraftDiscarded,
  clearSessionDraftDiscarded,
  drafts,
  finishPendingSend,
  imageDrafts,
  isPendingDraftDiscarded,
  isSessionDraftDiscarded,
  reviewDrafts,
  savePromptDraft,
  scrollDrafts,
} from "../../utils/draft-store"
import { ReviewComments } from "./ReviewComments"
import { partReview, reviewBody } from "../../../../src/shared/review-comments"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { MEMORY_USAGE, parseMemoryCommand } from "../../utils/memory-command"
import { useMemory } from "../../context/memory"

function mergeReviewComments(current: ReviewComment[], incoming: ReviewComment[]): ReviewComment[] {
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

interface PromptInputProps {
  blocked?: () => boolean
  blockedReason?: () => string | undefined
  /** When true, session is busy only because a suggestion is pending — treat as idle for input */
  suggesting?: () => boolean
  /** When true, session is busy only because a question is pending — treat as idle for input */
  questioning?: () => boolean
  boxId?: string
  pendingSessionID?: string
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
  const mention = useFileMention(vscode, sid, hasGit)
  const terminal = useTerminalContext(vscode)
  const git = useGitChangesContext(vscode, ctx, hasGit)
  const imageAttach = useImageAttachments()
  imageAttach.setFilePathDropHandler((paths) => {
    const cwd = server.workspaceDirectory()
    const resolved = paths.map((p) => convertToMentionPath(p, cwd))
    const ref = textareaRef
    if (!ref) return
    const val = ref.value
    const cursor = ref.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)
    const inserted = resolved.map((p) => `@${p}`).join(" ")
    const result = before + inserted + " " + after
    ref.value = result
    setText(result)
    mention.addPaths(resolved, cwd)
    const pos = cursor + inserted.length + 1
    ref.setSelectionRange(pos, pos)
    ref.focus()
    adjustHeight()
  })
  const history = usePromptHistory()
  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let slashDropdownRef: HTMLDivElement | undefined

  const boxKey = () => props.boxId ?? "prompt:default"
  const blockedHelpId = () => `${boxKey().replace(/[^a-zA-Z0-9_-]/g, "-")}-blocked-help`
  const rawKey = () =>
    sessionDraftKey(session.currentSessionID()) ??
    pendingDraftKey(props.pendingSessionID ?? session.draftSessionID()) ??
    "new"
  const draftKey = () => scopeDraftKey(boxKey(), rawKey())
  const saveDraft = (
    key: string,
    next: string,
    comments: ReviewComment[],
    imgs: ImageAttachment[],
    scroll = textareaRef?.scrollTop ?? scrollDrafts.get(key) ?? 0,
  ) => savePromptDraft(key, next, comments, imgs, scroll)
  const readDraft = () => ({
    text: text().trim(),
    comments: reviewComments(),
    images: imageAttach.images(),
    scroll: textareaRef?.scrollTop ?? scrollDrafts.get(draftKey()) ?? 0,
  })

  const [text, setText] = createSignal("")
  const [reviewComments, setReviewComments] = createSignal<ReviewComment[]>([])
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
      return hidden
    },
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

  const replaceReviewComments = (next: ReviewComment[]) => {
    setReviewComments(next)
    if (next.length === 0) {
      reviewDrafts.delete(draftKey())
      return
    }
    reviewDrafts.set(draftKey(), next)
  }

  const clearReviewComments = () => replaceReviewComments([])

  const removeReviewComment = (id: string) => {
    replaceReviewComments(reviewComments().filter((item) => item.id !== id))
  }

  // Save/restore input text when switching sessions.
  // Uses `on()` to track only draftKey — avoids re-running on every keystroke.
  createEffect(
    on(draftKey, (key, prev) => {
      if (prev !== undefined && prev !== key) {
        saveDraft(prev, untrack(text), untrack(reviewComments), untrack(imageAttach.images))
      }
      const draft = drafts.get(key) ?? ""
      const pending = reviewDrafts.get(key) ?? []
      const scroll = scrollDrafts.get(key) ?? 0
      setText(draft)
      setReviewComments(pending)
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
      window.dispatchEvent(new Event("focusPrompt"))
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
    const texts = msgs.map((m) => {
      const parts = session.getParts(m.id)
      return parts
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => partReview(part.metadata, part.text)?.body ?? part.text.replace(REVIEW_PREFIX, ""))
        .join("")
    })
    history.seed(texts)
  })

  // Focus textarea when any part of the app requests it
  const onFocusPrompt = (event: Event) => {
    const focus = () => {
      const ref = textareaRef
      if (!ref) return
      ref.focus({ preventScroll: true })
    }
    focus()
    if (!(event instanceof CustomEvent) || !event.detail?.restore) return
    const restore = () => {
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

  // Fill the draft from a quick-action chip (e.g. the empty-state suggestions) - only
  // when the box is empty, so it never clobbers something the user already typed.
  const onSetDraft = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return
    if (text().trim().length > 0) return
    setText(event.detail)
    window.dispatchEvent(new Event("focusPrompt"))
  }
  window.addEventListener("kilo:setPromptDraft", onSetDraft)
  onCleanup(() => window.removeEventListener("kilo:setPromptDraft", onSetDraft))

  // Start a new task, carrying over the current prompt text (without auto-sending it)
  const onNewTaskRequest = () => {
    const draft = text().trim()
    const comments = reviewComments()
    const imgs = imageAttach.images()
    const scroll = textareaRef?.scrollTop ?? 0
    const id = tabs?.add()
    if (!id) session.clearCurrentSession()
    const key = id ? scopeDraftKey(boxKey(), pendingDraftKey(id) ?? "new") : draftKey()
    saveDraft(key, draft, comments, imgs, scroll)
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
    saveDraft(scopeDraftKey(box, sessionDraftKey(sid)), draft.text, draft.comments, draft.images, draft.scroll)
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
  const isDisabled = () => !server.isConnected()
  const canUseSpeech = () => canUseSpeechToText(config(), provider.authStates())
  const speechModel = () => selectedSpeechToTextModel(config())
  const hasInput = () => text().trim().length > 0 || imageAttach.images().length > 0 || reviewComments().length > 0
  const canSend = () =>
    !isDisabled() &&
    !terminal.pending() &&
    !git.pending() &&
    !props.blocked?.() &&
    (speech.state() === "recording" || (hasInput() && !speech.active()))
  const sendLabel = () => {
    const reason = props.blockedReason?.()
    if (reason) return reason
    if (props.blocked?.()) return language.t("prompt.action.send.blocked")
    if (speech.state() === "recording") return language.t("prompt.action.send.recording")
    return language.t("prompt.action.send")
  }
  const showStop = () => isBusy() && !hasInput() && speech.state() !== "recording"
  const isAtEnd = () =>
    textareaRef ? atEnd(textareaRef.selectionStart, textareaRef.selectionEnd, textareaRef.value.length) : false
  const highlightMentions = () => {
    const paths = new Set(mention.mentionedPaths())
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

  const unsubAutoApprove = vscode.onMessage((message) => {
    if (message.type === "autoApproveState") {
      setAutoApprove(message.active)
    }
  })

  const restoreFailed = (failed: SendMessageFailedMessage) => {
    const draft = failed.review ? reviewBody(failed.review, failed.text) : failed.text
    if (draft === undefined) return
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
    const comments = failed.review?.comments ?? []
    const images = (failed.files ?? [])
      .filter((file) => file.mime.startsWith("image/") && file.url.startsWith("data:"))
      .map((file) => ({
        id: crypto.randomUUID(),
        filename: file.filename ?? "image",
        mime: file.mime,
        dataUrl: file.url,
      }))
    if (target !== draftKey()) {
      saveDraft(target, draft, comments, images, scrollDrafts.get(target) ?? 0)
      return
    }
    // Do not overwrite a new draft the user started while the send was in flight.
    if (text().trim() || reviewComments().length > 0 || imageAttach.images().length > 0) return
    replaceReviewComments(comments)
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

  const handleSandboxMessage = (message: ExtensionMessage) => {
    if (message.type === "sandboxDefaultStatus") {
      const matching = message.requestID !== undefined && message.requestID === sandboxRequest(undefined)
      if (sandboxID() && !matching) return false
      if (!server.isConnected()) return true
      if (matching) clearSandboxRequest(undefined, message.requestID!)
      const current = sandboxDefault()
      if (!current || current.revision <= message.revision) {
        setSandboxDefault({
          desired: message.desired,
          enabled: message.enabled,
          available: message.available,
          reason: message.reason,
          revision: message.revision,
        })
      }
      if (matching && !message.available) {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: message.reason,
        })
      }
      return true
    }

    if (message.type === "sandboxStatus") {
      const matching = message.requestID !== undefined && message.requestID === sandboxRequest(message.sessionID)
      if (!server.isConnected()) return true
      const current = sandboxes()
      if (matching) clearSandboxRequest(message.sessionID, message.requestID!)
      const next = applySandboxStates(current, message)
      if (next !== current) setSandboxes(next)
      const state = next[message.sessionID]
      if (message.sessionID === sandboxID()) {
        sandboxAttempts = 0
        if (sandboxRetry) clearTimeout(sandboxRetry)
        sandboxRetry = undefined
      }
      if (matching && !state.available) {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: state.reason,
        })
      }
      return true
    }

    if (message.type === "sandboxStatusError") {
      const matching = message.requestID !== undefined && message.requestID === sandboxRequest(message.sessionID)
      if (!server.isConnected()) return true
      const current = sandboxes()
      const state = current[message.sessionID]
      if (matching) clearSandboxRequest(message.sessionID, message.requestID!)
      if ((state?.revision ?? -1) > message.revision) return true
      if (!message.requestID) {
        const same = state?.directory === message.directory
        setSandboxes(
          applySandboxStates(current, {
            sessionID: message.sessionID,
            directory: message.directory,
            enabled: same ? state.enabled : false,
            available: false,
            reason: message.message,
            version: same ? state.version : 0,
            revision: message.revision,
          }),
        )
        if (message.sessionID === sandboxID()) retrySandbox(message.sessionID)
      }
      if (matching) {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: message.message,
        })
      }
      return true
    }

    if (message.type !== "configUpdated") return false
    requestSandbox()
    return true
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (handleSandboxMessage(message)) return

    if (message.type === "setChatBoxMessage") {
      setText(message.text)
      // Prefer the exact attachment paths when available (e.g. reverting to a
      // message with @mentions) — seedFromText re-derives candidate mentions
      // from raw text via regex, which truncates at the first space in a
      // filename and cannot be relied on to reconstruct spaced paths correctly.
      if (message.paths?.length) mention.seedFromParts(message.paths, message.text)
      else mention.seedFromText(message.text)
      if (textareaRef) {
        textareaRef.value = message.text
        adjustHeight()
      }
    }

    if (message.type === "appendChatBoxMessage") {
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

    if (message.type === "appendReviewComments") {
      const empty = !text().trim() && reviewComments().length === 0 && imageAttach.images().length === 0
      const merged = mergeReviewComments(reviewComments(), message.comments)
      replaceReviewComments(merged)
      if (message.autoSend && empty && !isDisabled() && !props.blocked?.()) {
        void handleSend()
      } else {
        textareaRef?.focus()
      }
    }

    if (message.type === "triggerTask") {
      if (isDisabled()) return
      const sel = session.selected(sid())
      session.sendMessage(message.text, sel?.providerID, sel?.modelID, undefined, undefined, ctx())
    }

    if (message.type === "sendMessageFailed") {
      restoreFailed(message as SendMessageFailedMessage)
    }

    if (message.type === "sessionCreated") {
      const raw = createdDraftKey(message.draftID, sandboxRequest(undefined) !== undefined)
      if (raw) {
        const source = scopeDraftKey(boxKey(), raw)
        const target = scopeDraftKey(boxKey(), sessionDraftKey(message.session.id))
        if (source === draftKey()) saveDraft(source, text(), reviewComments(), imageAttach.images())
        movePromptDraft(
          { text: drafts, comments: reviewDrafts, images: imageDrafts, scrolls: scrollDrafts },
          source,
          target,
        )
      }
      if (
        message.draftID &&
        !session.currentSessionID() &&
        (props.pendingSessionID ?? session.draftSessionID()) === message.draftID
      ) {
        session.setDraftSessionID(message.session.id)
      }
    }

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
      mention.insertFilePickerResult(message.path, message.requestId)
    }
  })
  vscode.postMessage({ type: "requestAutoApproveState" })

  onCleanup(() => {
    // Persist current draft before unmounting
    saveDraft(draftKey(), text(), reviewComments(), imageAttach.images())
    if (sandboxRetry) clearTimeout(sandboxRetry)
    unsubAutoApprove()
    unsubscribe()
  })

  const acceptSuggestion = () => {
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
    const val = target.value
    setText(val)
    preEnhanceText = null
    adjustHeight()
    syncHighlightScroll()
    history.reset()

    slash.onInput(val, target.selectionStart ?? val.length)
    mention.onInput(val, target.selectionStart ?? val.length)
    ghost.setMentionOpen(slash.show() || mention.showMention())
    ghost.scheduleRequest(val, textareaRef)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
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

    if (e.key === "Tab" && ghost.text()) {
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
    if (e.key === "Escape" && ghost.text()) {
      e.preventDefault()
      e.stopPropagation()
      ghost.dismiss()
      return
    }
    if (e.key === "Escape" && isBusy()) {
      e.preventDefault()
      e.stopPropagation()
      session.abort()
      return
    }
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
    const images = imageAttach.images()
    speech.stop({
      done: () => void handleSend(),
      ready: () =>
        draftKey() === key &&
        sid() === id &&
        ctx() === context &&
        text() === value &&
        reviewComments() === comments &&
        imageAttach.images() === images,
    })
  }

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
      showToast({ variant: "default", title: "/memory", description: MEMORY_USAGE })
      return true
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
    if (memory.kind === "show") vscode.postMessage({ type: "memoryShow", sessionID: sid() })
    if (memory.kind === "operation") {
      vscode.postMessage({
        type: "memoryOperation",
        operation: memory.operation,
        sessionID: sid(),
        ...(memory.operation === "auto" || memory.operation === "verbose" ? { mode: memory.mode } : {}),
        ...(memory.operation === "purge" ? { confirm: memory.confirm } : {}),
        ...(memory.operation === "remember" || memory.operation === "correct" ? { text: memory.text } : {}),
        ...(memory.operation === "forget" ? { query: memory.query } : {}),
      })
    }
    return true
  }

  const handleSend = async () => {
    const draft = text().trim()

    const memory = parseMemoryCommand(draft)
    if (memory) {
      if (!runMemory(memory)) return
      history.append(draft)
      setText("")
      clearReviewComments()
      imageAttach.clear()
      mention.closeMention()
      slash.close()
      drafts.delete(draftKey())
      reviewDrafts.delete(draftKey())
      imageDrafts.delete(draftKey())
      scrollDrafts.delete(draftKey())
      if (textareaRef) textareaRef.style.height = "auto"
      return
    }

    // Detect slash command (hoisted for both client and server command checks).
    // Prioritize exact name matches over hint/alias matches so that a server
    // command named e.g. "continue" is not hijacked by a client alias.
    const cmdMatch = draft.match(/^\/(\S+)/)
    const word = cmdMatch?.[1]
    const matched = word
      ? (slash.commands().find((c) => c.name === word) ?? slash.commands().find((c) => c.hints.includes(word)))
      : undefined

    // Client-side slash command — runs locally without a backend round-trip
    if (matched?.action) {
      if (matched.enabled && !matched.enabled()) return
      setText("")
      clearReviewComments()
      imageAttach.clear()
      mention.closeMention()
      slash.close()
      drafts.delete(draftKey())
      reviewDrafts.delete(draftKey())
      imageDrafts.delete(draftKey())
      scrollDrafts.delete(draftKey())
      if (textareaRef) textareaRef.style.height = "auto"
      matched.action()
      return
    }

    const imgs = imageAttach.images()
    const pending = reviewComments()
    const review = pending.length > 0 ? formatReviewCommentsMarkdown(pending) : ""
    const message = draft && review ? `${review}\n\n${draft}` : draft || review
    const data = review ? { version: 1 as const, comments: pending } : undefined
    if (
      (!message && imgs.length === 0) ||
      isDisabled() ||
      speech.active() ||
      terminal.pending() ||
      git.pending() ||
      props.blocked?.()
    )
      return

    const mentionFiles = mention.parseFileAttachments(draft)
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl, filename: img.filename }))
    const origin = session.currentSessionID()
    const pendingId = props.pendingSessionID ?? (!origin ? session.draftSessionID() : undefined)
    const id = origin ?? pendingId
    beginPending(pendingId)
    const sel = session.selected(id)
    const context = ctx()
    const key = draftKey()

    const terminalFile = await terminal.resolveAttachment(message, id).catch((err: Error) => {
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

    // Server-side slash command (cmdMatch/matched already computed above)
    if (matched && !data) {
      const args = draft.slice(cmdMatch![0].length).trim()
      session.sendCommand(
        matched.name,
        args,
        sel?.providerID,
        sel?.modelID,
        attachments,
        pendingId,
        context,
        origin ?? null,
      )
    } else {
      session.sendMessage(message, sel?.providerID, sel?.modelID, attachments, pendingId, context, data, origin ?? null)
    }

    drafts.delete(key)
    reviewDrafts.delete(key)
    imageDrafts.delete(key)
    scrollDrafts.delete(key)
    history.append(draft)
    if (draftKey() !== key) return

    history.reset()
    setText("")
    clearReviewComments()
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
      onDrop={imageAttach.handleDrop}
    >
      <Show when={reviewComments().length > 0}>
        <ReviewComments
          comments={reviewComments()}
          sessionID={sid()}
          onRemove={removeReviewComment}
          onClear={clearReviewComments}
        />
      </Show>
      <Show when={mention.showMention()}>
        <div class="file-mention-dropdown" ref={dropdownRef}>
          <Show
            when={mention.mentionResults().length > 0}
            fallback={<div class="file-mention-empty">No files or folders found</div>}
          >
            <For each={mention.mentionResults()}>
              {(item, index) => (
                <>
                  <div
                    class="file-mention-item"
                    classList={{ "file-mention-item--active": index() === mention.mentionIndex() }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (textareaRef) mention.selectMention(item, textareaRef, setText, adjustHeight)
                    }}
                    onMouseEnter={() => mention.setMentionIndex(index())}
                  >
                    {item.type === "terminal" ? (
                      <>
                        <Icon name="console" class="file-mention-icon" />
                        <span class="file-mention-name">{item.label}</span>
                        <span class="file-mention-dir">{item.description}</span>
                      </>
                    ) : item.type === "git-changes" ? (
                      <>
                        <Icon name="branch" class="file-mention-icon" />
                        <span class="file-mention-name">{item.label}</span>
                        <span class="file-mention-dir">{item.description}</span>
                      </>
                    ) : item.type === "file-picker" ? (
                      <>
                        <Icon name="folder" class="file-mention-icon" />
                        <span class="file-mention-name">{item.label}</span>
                        <span class="file-mention-dir">{item.description}</span>
                      </>
                    ) : (
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
                    )}
                  </div>
                  <Show when={item.type === "file-picker" && index() < mention.mentionResults().length - 1}>
                    <div class="file-mention-separator" />
                  </Show>
                </>
              )}
            </For>
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
                  onClick={() => imageAttach.remove(img.id)}
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
            classList={{ "prompt-input--disabled": isDisabled() }}
            placeholder={placeholder()}
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onKeyUp={syncGhost}
            onPaste={handlePaste}
            onClick={syncGhost}
            onFocus={syncGhost}
            onBlur={syncGhost}
            onSelect={() => {
              syncGhost()
              if (textareaRef) mention.snapSelection(textareaRef)
            }}
            onScroll={syncHighlightScroll}
            aria-disabled={isDisabled()}
            aria-describedby={props.blockedReason?.() ? blockedHelpId() : undefined}
            rows={1}
            dir="auto"
          />
        </div>
      </div>
      <Show when={props.blockedReason?.()} keyed>
        {(reason) => (
          <span id={blockedHelpId()} class="sr-only" role="status">
            {reason}
          </span>
        )}
      </Show>
      <div class="prompt-input-hint">
        <div class="prompt-input-hint-selectors">
          <ModeSwitcher sessionID={sid} />
          <ModelSelector sessionID={sid} />
          <ThinkingSelector sessionID={sid} />
          <Show when={session.hasModelOverride(sid())}>
            <Tooltip value={language.t("prompt.action.resetModel")} placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={() => session.clearModelOverride(sid())}
                aria-label={language.t("prompt.action.resetModel")}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
        </div>
        <div class="prompt-input-hint-actions">
          <Show when={showIndexing()}>
            <Tooltip value={indexing.status().message || indexing.label()} placement="top">
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
          <Tooltip value={language.t("prompt.action.enhance")} placement="top">
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
              <Tooltip value={sendLabel()} placement="top">
                <Button
                  variant="ghost"
                  size="small"
                  onClick={handleSendClick}
                  aria-disabled={!canSend()}
                  aria-describedby={props.blockedReason?.() ? blockedHelpId() : undefined}
                  aria-label={sendLabel()}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.5 1.5L14.5 8L1.5 14.5V9L10 8L1.5 7V1.5Z" />
                  </svg>
                </Button>
              </Tooltip>
            }
          >
            <Tooltip value={language.t("prompt.action.stop")} placement="top">
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
