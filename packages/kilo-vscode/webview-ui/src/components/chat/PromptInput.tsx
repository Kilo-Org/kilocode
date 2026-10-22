/**
 * PromptInput component
 * Text input with send/abort buttons and @ file mention support
 */

import {
  createSignal,
  createEffect,
  createMemo,
  on,
  onMount,
  For,
  Index,
  onCleanup,
  Show,
  untrack,
  type Component,
} from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import {
  createHold,
  hasPopup,
  hasTextSelection,
  isTextControl,
  ownsFocusRegion,
  pasteToPrompt,
} from "../../utils/focus"
import { useSession } from "../../context/session"
import { useLocalTabs } from "../../context/local-tabs"
import { showTabStrip } from "../../utils/local-tabs"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useConfig } from "../../context/config"
import { recommend } from "../../utils/shortcut-hint"
import { PromptHint } from "./PromptHint"
import { useProvider } from "../../context/provider"
import { ModelSelector, ModelSelectorBase } from "../shared/ModelSelector"
import { ModeSwitcher } from "../shared/ModeSwitcher"
import { ThinkingSelector } from "../shared/ThinkingSelector"
import { PromptSelectors } from "./PromptSelectors"
import { useFileMention } from "../../hooks/useFileMention"
import { usePasteCollapse } from "../../hooks/usePasteCollapse"
import type { MentionResult } from "../../hooks/file-mention-utils"
import { isMentionEntry } from "../../hooks/file-mention-utils"
import { useSlashCommand, skill as isSkill } from "../../hooks/useSlashCommand"
import { useImageAttachments, type ImageAttachment } from "../../hooks/useImageAttachments"
import { convertToMentionPath, insertPathMentions } from "../../utils/path-mentions"
import { promptMentionOver, registerPromptMentionDrop } from "../../utils/prompt-mention-drop"
import { SessionMentionPicker } from "./SessionMentionPicker"
import { formatRelativeDate } from "../../utils/date"
import { usePromptHistory } from "../../hooks/usePromptHistory"
import { cycleVariant } from "../../context/session-variant-store"
import { fileName, dirName, isPromptBusy, isPathMention, undoKey } from "./prompt-input-utils"
import type { ExtensionMessage, SendMessageFailedMessage, TextPart } from "../../types/messages"
import {
  createdDraftKey,
  failedPrompt,
  movePromptDraft,
  pendingDraftKey,
  promotePromptDraft,
  scopeDraftKey,
  sessionDraftKey,
} from "../../utils/prompt-drafts"
import {
  beginPendingSend,
  clearPendingDraftDiscarded,
  clearSessionDraftDiscarded,
  contextDrafts,
  drafts,
  finishPendingSend,
  imageDrafts,
  mentionDrafts,
  isPendingDraftDiscarded,
  isSessionDraftDiscarded,
  pasteDrafts,
  savePromptDraft,
  scrollDrafts,
} from "../../utils/draft-store"
import { CodeContextChips } from "./CodeContextChips"
import { partInjected } from "../../../../src/shared/injected-prompt"
import { formatCodeContexts, mergeCodeContexts, type CodeContext } from "../../../../src/shared/code-context"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"

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
  /** Treat a session that waits for a question as idle for input. */
  questioning?: () => boolean
  /** When true, defer prompt focus while switching to a pending question */
  deferFocusToQuestion?: () => boolean
  boxId?: string
  pendingSessionID?: string
  /** Whether changing the draft should restore prompt focus. */
  focusOnDraftChange?: () => boolean
  onFocusChange?: (focused: boolean) => void
}

// The `@` model entry reopens the shared model selector through its
// programmatic-open event, keyed to this prompt scope so the chat model
// selector and slash-command opens are unaffected.
const MENTION_MODEL_TRIGGER = "mention-model"

function MentionItemContent(props: { item: MentionResult }) {
  const item = props.item
  if (item.type === "git-changes")
    return (
      <>
        <Icon name="branch" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
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
  if (item.type === "model")
    return (
      <>
        <Icon name="models" class="file-mention-icon" />
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
      {/* Without the folder name, two roots holding the same relative path render identically. */}
      <Show when={item.root}>{(root) => <span class="file-mention-root">{root()}</span>}</Show>
      {/* Shown relative to its own folder: the badge already names the folder, and
          the absolute form would spell out the local filesystem layout instead. */}
      <span class="file-mention-dir">{dirName(item.relative ?? item.value)}</span>
    </>
  )
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const session = useSession()
  const tabs = useLocalTabs()
  const server = useServer()
  const { globalConfig, settings, shortcuts } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  const sid = () => session.currentSessionID() ?? props.pendingSessionID ?? session.draftSessionID() ?? undefined
  // The git changes context needs the Agent Manager Git module on the host, which is off on the Kilo v2 line.
  const hasGit = () => false
  const modelKeys = createMemo(() => new Set(provider.models().map((model) => `${model.providerID}/${model.id}`)))
  const mention = useFileMention(vscode, sid, hasGit, modelKeys)
  // Picking the `@` model entry reuses the shared model selector: it is
  // mounted hidden and opened through its programmatic-open event. The mention
  // latch resets immediately because the selector owns its own open state, so
  // dismissing it by clicking outside cannot leave the latch stuck open.
  createEffect(() => {
    if (!mention.modelPicker()) return
    mention.closeMention()
    window.dispatchEvent(new CustomEvent("openModelPicker", { detail: { source: MENTION_MODEL_TRIGGER } }))
  })
  const imageAttach = useImageAttachments()
  imageAttach.setFilePathDropHandler((paths) => {
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
  // Shared across conversations unless the user opts in to a separate history per conversation.
  const scoped = () => settings().conversationPromptHistory === true
  const history = usePromptHistory(sid, () => !scoped())
  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let slashDropdownRef: HTMLDivElement | undefined
  let containerRef: HTMLDivElement | undefined

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
  const rawKey = () =>
    sessionDraftKey(session.currentSessionID()) ??
    pendingDraftKey(props.pendingSessionID ?? session.draftSessionID()) ??
    "new"
  const draftKey = () => scopeDraftKey(boxKey(), rawKey())
  const saveDraft = (
    key: string,
    next: string,
    imgs: ImageAttachment[],
    scroll = textareaRef?.scrollTop ?? scrollDrafts.get(key) ?? 0,
    codeContexts: CodeContext[] = contexts(),
    pastes = key === draftKey() ? paste.pastes().map((item) => item.text) : undefined,
  ) => savePromptDraft(key, next, imgs, scroll, codeContexts, pastes)

  const [text, setText] = createSignal("")
  const [focused, setFocused] = createSignal(false)
  const [away, setAway] = createSignal(!document.hasFocus())
  const onWindowFocus = () => setAway(false)
  const onWindowBlur = () => setAway(true)
  window.addEventListener("focus", onWindowFocus)
  window.addEventListener("blur", onWindowBlur)
  onCleanup(() => {
    window.removeEventListener("focus", onWindowFocus)
    window.removeEventListener("blur", onWindowBlur)
  })
  const hint = () => {
    if (settings().showShortcutHints === false || props.blocked?.()) return undefined
    return recommend({
      bindings: shortcuts().bindings,
      focused: focused(),
      away: away(),
      draft: !!text(),
      busy: isBusy(),
      selection: shortcuts().selection,
      tabs: showTabStrip(tabs?.display() ?? []),
    })
  }
  const modeHint = () => {
    const keybind = shortcuts().bindings.cycleAgentMode
    return keybind ? { title: language.t("prompt.shortcutHint.mode"), keybind } : undefined
  }
  // Large pastes collapse into a `[Pasted ~N lines]` chip, matching the CLI and
  // JetBrains plugin. Honor the same experimental opt-out.
  const paste = usePasteCollapse({
    enabled: () => globalConfig()?.experimental?.disable_paste_summary !== true,
    text,
  })
  const [contexts, setContexts] = createSignal<CodeContext[]>([])
  const slash = useSlashCommand(vscode, () => {
    const hidden = new Set<string>()
    if (session.variantList(sid()).length === 0) hidden.add("variant")
    return hidden
  })

  const replaceContexts = (next: CodeContext[]) => {
    setContexts(next)
    if (next.length === 0) {
      contextDrafts.delete(draftKey())
      return
    }
    contextDrafts.set(draftKey(), next)
  }

  const removeContext = (id: string) => {
    replaceContexts(contexts().filter((item) => item.id !== id))
  }
  const clearContexts = () => replaceContexts([])

  // Save/restore input text when switching sessions.
  // Uses `on()` to track only draftKey, without running again on every keystroke.
  createEffect(
    on(draftKey, (key, prev) => {
      if (prev !== undefined && prev !== key) {
        const val = untrack(text)
        const imgs = untrack(imageAttach.images)
        const codeContexts = untrack(contexts)
        if (val || imgs.length > 0 || codeContexts.length > 0 || drafts.has(prev)) {
          saveDraft(
            prev,
            val,
            imgs,
            undefined,
            codeContexts,
            untrack(paste.pastes).map((item) => item.text),
          )
        }
      }
      const draft = drafts.get(key) ?? ""
      const scroll = scrollDrafts.get(key) ?? 0
      setText(draft)
      paste.load(draft, pasteDrafts.get(key) ?? [])
      mention.seedFromText(draft)
      const refs = mentionDrafts.get(key)
      if (refs) {
        mention.seedFromParts(refs.paths, draft)
        mention.seedSessions(refs.sessions, draft)
      }
      setContexts(contextDrafts.get(key) ?? [])
      imageAttach.replace(imageDrafts.get(key) ?? [])
      history.reset()
      if (textareaRef) {
        if (textareaRef.value !== draft) textareaRef.value = draft
        adjustHeight()
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
  createEffect(() => {
    const msgs = session.userMessages()
    if (msgs.length === 0) return
    const timer = setTimeout(() => {
      const texts = msgs.map((m) => {
        const parts = session.getParts(m.id)
        return parts
          .filter((part): part is TextPart => part.type === "text")
          .map((part) => {
            const injected = partInjected(part.metadata)
            if (injected) return injected.title.startsWith("/") ? injected.title : ""
            return part.text
          })
          .join("")
      })
      history.seed(texts)
    }, 100)
    onCleanup(() => clearTimeout(timer))
  })

  // Focus textarea when any part of the app requests it
  const onFocusPrompt = (event: Event) => {
    const force = event instanceof CustomEvent && event.detail?.force === true
    const defer = () =>
      event instanceof CustomEvent && event.detail?.deferFocusToQuestion && props.deferFocusToQuestion?.()
    const ownsFocus = (explicit = false) => {
      const active = document.activeElement
      return (
        (!explicit && ownsFocusRegion(active)) ||
        hasPopup() ||
        (active !== textareaRef && isTextControl(active)) ||
        hasTextSelection()
      )
    }
    const focus = (explicit = false) => {
      if (defer() || ownsFocus(explicit)) return
      const ref = textareaRef
      if (!ref) return
      ref.focus({ preventScroll: true })
    }
    focus(force)
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

  const hold = createHold({
    target: () => textareaRef,
    busy: () => hasPopup(),
  })
  window.addEventListener("focus", hold.reclaim)
  onCleanup(() => window.removeEventListener("focus", hold.reclaim))

  // Start a new task, carrying over the current prompt text (without auto-sending it)
  const onNewTaskRequest = () => {
    const draft = text().trim()
    const imgs = imageAttach.images()
    const scroll = textareaRef?.scrollTop ?? 0
    // Capture paste backing before tabs.add() switches the draft and clears it.
    const pastes = paste.pastes().map((item) => item.text)
    const id = tabs?.add()
    if (!id) session.clearCurrentSession()
    const key = id ? scopeDraftKey(boxKey(), pendingDraftKey(id) ?? "new") : draftKey()
    saveDraft(key, draft, imgs, scroll, undefined, pastes)
  }
  window.addEventListener("newTaskRequest", onNewTaskRequest)
  onCleanup(() => window.removeEventListener("newTaskRequest", onNewTaskRequest))

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

  const isBusy = () => isPromptBusy(session.status(), !!props.questioning?.(), session.submitting())
  const isDisabled = () => !server.isConnected()
  const hasInput = () => text().trim().length > 0 || imageAttach.images().length > 0 || contexts().length > 0
  const sendReady = () => !isDisabled() && !props.blocked?.()
  const canSend = () => sendReady() && hasInput()
  const sendLabel = () => {
    if (props.blocked?.()) return language.t("prompt.action.send.blocked")
    return language.t("prompt.action.send")
  }
  const showStop = () => isBusy() && !hasInput()
  const stopLabel = () => language.t("prompt.action.stop")
  const highlightMentions = () => {
    const paths = new Set(mention.mentionedPaths())
    for (const token of mention.mentionedSessions().keys()) paths.add(token)
    for (const token of mention.mentionedModels()) paths.add(token)
    return paths
  }
  // Model references are inline text tokens, not files, so they must not be
  // styled as or behave like clickable path mentions.
  const isModelMention = (text: string) => mention.mentionedModels().has(text.replace(/^@/, ""))
  const placeholder = () => {
    switch (server.connectionState()) {
      case "connecting":
        return language.t("prompt.placeholder.connecting")
      case "error":
        return language.t("prompt.placeholder.error")
      default: {
        // The contextual shortcut replaces the generic key help in the same template.
        const next = hint()
        if (!next) return language.t("prompt.placeholder.default")
        return language.t("prompt.placeholder.hint", {
          // Keep chords like "⌘K ⌘A" on one line.
          key: next.binding.replaceAll(" ", "\u00a0"),
          action: language.t(`prompt.shortcutHint.${next.label}`),
        })
      }
    }
  }
  // The same template as the placeholder, split around the key so it can render as keycaps.
  const keycaps = createMemo(
    () => {
      const state = server.connectionState()
      if (state === "connecting" || state === "error") return undefined
      const next = hint()
      if (!next) return undefined
      const mark = "\u0001"
      const parts = language
        .t("prompt.placeholder.hint", { key: mark, action: language.t(`prompt.shortcutHint.${next.label}`) })
        .split(mark)
      return { before: parts.at(0) ?? "", after: parts.at(1) ?? "", binding: next.binding }
    },
    undefined,
    // Recreate the overlay only when the visible tip changes, so its fade-in runs once per tip.
    { equals: (a, b) => a?.before === b?.before && a?.after === b?.after && a?.binding === b?.binding },
  )

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
    const images = (failed.files ?? [])
      .filter((file) => file.mime.startsWith("image/") && file.url.startsWith("data:"))
      .map((file) => ({
        id: crypto.randomUUID(),
        filename: file.filename ?? "image",
        mime: file.mime,
        dataUrl: file.url,
      }))
    if (target !== draftKey()) {
      saveDraft(target, draft, images, scrollDrafts.get(target) ?? 0, [])
      return
    }
    // Do not overwrite a new draft the user started while the send was in flight.
    if (text().trim() || imageAttach.images().length > 0 || contexts().length > 0) return
    clearContexts()
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

  const restoreBox = (message: Extract<ExtensionMessage, { type: "setChatBoxMessage" }>, key = draftKey()) => {
    if (key !== draftKey()) {
      savePromptDraft(
        key,
        message.text,
        message.images?.map((image) => ({ ...image, id: crypto.randomUUID(), filename: image.filename ?? "image" })) ??
          imageDrafts.get(key) ??
          [],
        scrollDrafts.get(key),
      )
      if (message.paths || message.sessions)
        mentionDrafts.set(key, { paths: message.paths ?? [], sessions: message.sessions ?? [] })
      return
    }
    setText(message.text)
    paste.load(message.text, pasteDrafts.get(key) ?? [])
    if (message.paths?.length) mention.seedFromParts(message.paths, message.text)
    else mention.seedFromText(message.text)
    if (message.sessions?.length) mention.seedSessions(message.sessions, message.text)
    if (textareaRef) {
      textareaRef.value = message.text
      adjustHeight()
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
    if (key !== draftKey()) {
      const current = drafts.get(key) ?? ""
      drafts.set(key, current + (current && !current.endsWith("\n") ? "\n\n" : "") + message.text)
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

  const appendContext = (message: Extract<ExtensionMessage, { type: "appendChatContext" }>, key = draftKey()) => {
    if (key !== draftKey()) {
      contextDrafts.set(key, mergeCodeContexts(contextDrafts.get(key) ?? [], [message.context]))
      return
    }
    replaceContexts(mergeCodeContexts(contexts(), [message.context]))
    textareaRef?.focus()
  }

  const created = (message: Extract<ExtensionMessage, { type: "sessionCreated" }>) => {
    const raw = createdDraftKey(message.draftID)
    if (!raw) return
    const source = scopeDraftKey(boxKey(), raw)
    const target = scopeDraftKey(boxKey(), sessionDraftKey(message.session.id))
    if (message.draftID) history.move(message.draftID, message.session.id)
    if (source === draftKey()) saveDraft(source, text(), imageAttach.images())
    movePromptDraft(
      {
        text: drafts,
        images: imageDrafts,
        scrolls: scrollDrafts,
        pastes: pasteDrafts,
        contexts: contextDrafts,
      },
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
    if (message.type === "setChatBoxMessage") {
      restoreBox(message)
    }

    if (message.type === "appendChatBoxMessage") appendBox(message)

    if (message.type === "appendChatContext") appendContext(message)

    if (message.type === "triggerTask") {
      if (isDisabled()) return
      const sel = session.selected(sid())
      session.sendMessage(
        message.text,
        sel?.providerID,
        sel?.modelID,
        undefined,
        undefined,
        undefined,
        message.injectedTitle,
      )
    }

    if (message.type === "sendMessageFailed") {
      restoreFailed(message as SendMessageFailedMessage)
    }

    if (message.type === "sessionCreated") created(message)

    if (message.type === "action" && message.action === "focusInput") {
      textareaRef?.focus()
    }

    if (message.type === "action" && message.action === "restoreInput") {
      if (hasPopup()) return
      const active = document.activeElement
      if (ownsFocusRegion(active)) return
      if (active && active !== textareaRef && isTextControl(active)) return
      textareaRef?.focus({ preventScroll: true })
    }

    if (message.type === "filePickerResult") {
      mention.insertFilePickerResult(message.path, message.requestId)
    }
  })

  onCleanup(() => {
    // Persist current draft before unmounting
    saveDraft(draftKey(), text(), imageAttach.images())
    unsubscribe()
  })

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
    // Empty drafts use rows=1 and the CSS minimum without forcing layout.
    if (!textareaRef.value) return
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const handlePaste = (e: ClipboardEvent) => {
    imageAttach.handlePaste(e)
    // Collapse a large plain-text paste into a chip before the browser inserts
    // it; images and files keep the default path.
    if (
      textareaRef &&
      paste.paste(e, textareaRef, setText, () => {
        adjustHeight()
        syncHighlightScroll()
      })
    ) {
      return
    }
    // After pasting text, the textarea content changes but the layout may not
    // have reflowed yet, causing the caret position to be visually out of sync.
    // Defer height recalculation to after the browser completes the reflow.
    requestAnimationFrame(() => {
      adjustHeight()
      syncHighlightScroll()
    })
  }
  const onPaste = (event: ClipboardEvent) => pasteToPrompt(event, textareaRef, handlePaste)
  window.addEventListener("paste", onPaste)
  onCleanup(() => window.removeEventListener("paste", onPaste))

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    const val = target.value
    setText(val)
    // setText has reconciled by here, so the span this edit recorded is spent.
    paste.afterInput()
    adjustHeight()
    syncHighlightScroll()
    history.reset()

    slash.onInput(val, target.selectionStart ?? val.length)
    mention.onInput(val, target.selectionStart ?? val.length)
  }

  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return false
    if (hasPopup()) return true
    if (!isBusy()) return false
    e.preventDefault()
    e.stopPropagation()
    session.abort()
    return true
  }

  // Keep native undo/redo inside the prompt instead of the workbench editor.
  const undo = (e: KeyboardEvent): boolean => {
    const action = undoKey(e)
    if (!action) return false
    e.stopPropagation()
    e.preventDefault()
    document.execCommand(action)
    return true
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // Atomic mention removal on backspace
    if (
      mention.handleBackspace(e, textareaRef, setText, () => {
        adjustHeight()
        syncHighlightScroll()
      })
    )
      return

    // Atomic collapsed-paste removal on backspace
    if (paste.backspace(e, textareaRef, setText)) {
      adjustHeight()
      syncHighlightScroll()
      return
    }

    // Skip cursor over mentions and collapsed pastes on arrow keys
    paste.arrow(e, textareaRef)
    if (mention.handleArrowKey(e, textareaRef)) return

    if (slash.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      queueMicrotask(scrollToActiveSlashItem)
      return
    }

    if (mention.onKeyDown(e, textareaRef, setText, adjustHeight)) {
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
      const backing = paste.pastes().map((item) => item.text)
      const entry = history.navigate(direction, text(), cursor, backing)
      if (entry !== null) {
        e.preventDefault()
        setText(entry.text)
        paste.load(entry.text, entry.pastes)
        if (textareaRef) {
          textareaRef.value = entry.text
          adjustHeight()
          const pos = direction === "up" ? 0 : entry.text.length
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

    if (escape(e)) return
    if (isEnterKeyCommitNotIme(e) && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
    // Collapsed pastes are expanded to their full content before anything reads
    // the draft: sending, attachments, slash detection, and history all see the
    // real text, never the placeholder.
    const draft = paste.plainText(text()).trim()

    // Detect slash command (hoisted for both client and server command checks).
    // Prioritize exact name matches over hint/alias matches so that a server
    // command named e.g. "continue" is not hijacked by a client alias.
    const parsed = command(draft)
    const cmdMatch = parsed.match
    const matched = parsed.entry

    // Client-side slash commands run locally without a backend round-trip.
    if (matched?.action) {
      if (matched.enabled && !matched.enabled()) return
      setText("")
      clearContexts()
      imageAttach.clear()
      mention.closeMention()
      slash.close()
      drafts.delete(draftKey())
      contextDrafts.delete(draftKey())
      imageDrafts.delete(draftKey())
      mentionDrafts.delete(draftKey())
      scrollDrafts.delete(draftKey())
      pasteDrafts.delete(draftKey())
      if (textareaRef) textareaRef.style.height = "auto"
      matched.action()
      return
    }

    const imgs = imageAttach.images()
    const contextText = formatCodeContexts(contexts())
    const message = [contextText, draft].filter(Boolean).join("\n\n")
    if ((!message && imgs.length === 0) || !sendReady()) return

    const mentionFiles = mention.parseFileAttachments(draft)
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl, filename: img.filename }))
    const origin = session.currentSessionID()
    const pendingId = props.pendingSessionID ?? (!origin ? session.draftSessionID() : undefined)
    const id = origin ?? pendingId
    beginPending(pendingId)
    const sel = session.selected(id)
    const key = draftKey()
    if (isDisabled()) {
      finishPending(pendingId)
      return
    }
    if (finishPending(pendingId)) return

    const allFiles = [...mentionFiles, ...imgFiles]
    const attachments = allFiles.length > 0 ? allFiles : undefined

    // Server-side slash command (cmdMatch/matched already computed above)
    const accepted =
      matched && contexts().length === 0
        ? session.sendCommand(
            matched.name,
            draft.slice(cmdMatch![0].length).trim(),
            sel?.providerID,
            sel?.modelID,
            attachments,
            pendingId,
            origin ?? null,
            { agent: matched.agent, model: matched.model, variant: matched.variant },
          )
        : session.sendMessage(message, sel?.providerID, sel?.modelID, attachments, pendingId, origin ?? null)
    if (!accepted) return

    // `id` was captured before any await above, so it still names the conversation this message was sent to.
    clearDraft(key, draft, id)
  }

  const clearDraft = (key: string, value?: string, historyKey?: string) => {
    if (value === undefined) {
      const active = key === draftKey()
      const source = active ? text() : (drafts.get(key) ?? "")
      const backing = active ? paste.pastes().map((item) => item.text) : (pasteDrafts.get(key) ?? [])
      value = paste.plainTextFor(source, backing).trim()
    }
    history.append(value, historyKey)
    drafts.delete(key)
    contextDrafts.delete(key)
    imageDrafts.delete(key)
    mentionDrafts.delete(key)
    scrollDrafts.delete(key)
    pasteDrafts.delete(key)
    if (draftKey() !== key) return

    history.reset()
    setText("")
    clearContexts()
    imageAttach.clear()
    mention.closeMention()
    slash.close()

    if (textareaRef) textareaRef.style.height = "auto"
  }

  onMount(() => {
    registerPromptMentionDrop(containerRef, (drop) => {
      const ref = textareaRef
      if (!ref || !ref.isConnected) return false
      return mention.insertDrop(drop, ref, setText, server.workspaceDirectory(), adjustHeight)
    })
    onCleanup(() => registerPromptMentionDrop(undefined, undefined))
  })

  return (
    <div
      ref={containerRef}
      class="prompt-input-container"
      classList={{
        "prompt-input-container--dragging": imageAttach.dragging(),
        "prompt-input-container--mention-drop": promptMentionOver(),
      }}
      onDragOver={imageAttach.handleDragOver}
      onDragLeave={imageAttach.handleDragLeave}
      onDrop={imageAttach.handleDrop}
    >
      <Show when={contexts().length > 0}>
        <CodeContextChips contexts={contexts()} sessionID={sid()} onRemove={removeContext} onClear={clearContexts} />
      </Show>
      <div class="mention-model-anchor" aria-hidden="true">
        <ModelSelectorBase
          value={null}
          trigger={MENTION_MODEL_TRIGGER}
          collapsed
          onSelect={(providerID, modelID) => {
            if (providerID && modelID) mention.selectModelReference(providerID, modelID, adjustHeight)
          }}
          onCancel={() => {
            mention.closeMention()
            textareaRef?.focus()
          }}
        />
      </div>
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
              when={mention.mentionResults().length > 0}
              fallback={<div class="file-mention-empty">No files or folders found</div>}
            >
              <For each={mention.mentionResults()}>
                {(item, index) => (
                  <>
                    {/* Rendered in the webview rather than as a native `title`, which
                        macOS does not reliably show inside VS Code webviews. */}
                    <Tooltip
                      value={
                        item.type === "file" || item.type === "folder" || item.type === "opened-file"
                          ? item.value
                          : undefined
                      }
                      placement="top-start"
                      contentClass="file-mention-tooltip"
                    >
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
                    </Tooltip>
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
              const commands = all.filter((c) => !c.action && !isSkill(c))
              const skills = all.filter(isSkill)
              // results() is ordered actions, commands, skills; keyboard indexes follow that order.
              const groups = [
                { label: "Actions", items: actions, offset: 0 },
                { label: "Commands", items: commands, offset: actions.length },
                { label: "Skills", items: skills, offset: actions.length + commands.length },
              ].filter((group) => group.items.length > 0)
              return (
                <For each={groups}>
                  {(group, g) => (
                    <>
                      <Show when={g() > 0}>
                        <div class="slash-command-separator" />
                      </Show>
                      <div class="slash-command-group-label">{group.label}</div>
                      <For each={group.items}>
                        {(cmd, idx) => (
                          <div
                            class="slash-command-item"
                            classList={{ "slash-command-item--active": idx() + group.offset === slash.index() }}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              if (textareaRef) slash.select(cmd, textareaRef, setText, adjustHeight)
                            }}
                            onMouseEnter={() => slash.setIndex(idx() + group.offset)}
                          >
                            <span class="slash-command-name">/{cmd.name}</span>
                            <Show when={cmd.description}>
                              <span class="slash-command-desc">{cmd.description}</span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </>
                  )}
                </For>
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
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  size="small"
                  class="image-attachment-remove"
                  onClick={() => imageAttach.remove(img.id)}
                  aria-label="Remove image"
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <Show when={keycaps()} keyed>
            {(caps) => <PromptHint before={caps.before} binding={caps.binding} after={caps.after} />}
          </Show>
          <div class="prompt-input-highlight-overlay" ref={highlightRef} aria-hidden="true" dir="auto">
            <Index each={paste.segments(text(), highlightMentions())}>
              {(seg) => (
                <Show
                  when={seg().kind !== "paste"}
                  fallback={
                    <span
                      class="prompt-input-paste"
                      title={language.t("prompt.paste.expand")}
                      onClick={(e) => {
                        if (!textareaRef) return
                        e.preventDefault()
                        e.stopPropagation()
                        paste.expand(seg().paste!, textareaRef, setText, () => {
                          // A large expansion writes the textarea value directly
                          // and skips the input handler. Reset history, but do
                          // not treat restored paste contents as new mentions.
                          history.reset()
                          adjustHeight()
                          syncHighlightScroll()
                        })
                      }}
                    >
                      {seg().text}
                    </span>
                  }
                >
                  <Show when={seg().kind === "mention"} fallback={<span>{seg().text}</span>}>
                    <span
                      class="prompt-input-file-mention"
                      classList={{
                        "prompt-input-file-mention--file": isPathMention(seg().text) && !isModelMention(seg().text),
                      }}
                      onClick={(e) => {
                        if (!isPathMention(seg().text)) return
                        if (isModelMention(seg().text)) return
                        if (mention.mentionedSessions().has(seg().text.replace(/^@/, ""))) return
                        e.preventDefault()
                        e.stopPropagation()
                        vscode.postMessage({ type: "openFile", filePath: seg().text.replace(/^@/, "") })
                      }}
                    >
                      {seg().text}
                    </span>
                  </Show>
                </Show>
              )}
            </Index>
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
            classList={{
              "prompt-input--disabled": !server.isConnected(),
              "prompt-input--keycaps": !!keycaps(),
            }}
            data-hint={hint()?.label}
            placeholder={placeholder()}
            value={text()}
            onBeforeInput={(e) => paste.beforeInput(e, textareaRef)}
            onInput={handleInput}
            onKeyDown={(e) => {
              if (undo(e)) return
              handleKeyDown(e)
            }}
            onPaste={handlePaste}
            onCopy={(e) => {
              paste.clipboard(e, textareaRef, setText)
            }}
            onCut={(e) => {
              if (!paste.clipboard(e, textareaRef, setText, true)) return
              adjustHeight()
              syncHighlightScroll()
            }}
            onFocus={() => {
              hold.claim()
              setFocused(true)
              props.onFocusChange?.(true)
            }}
            onBlur={() => {
              hold.release()
              setFocused(false)
              props.onFocusChange?.(false)
            }}
            onSelect={() => {
              if (textareaRef) mention.snapSelection(textareaRef)
            }}
            onScroll={syncHighlightScroll}
            aria-disabled={!server.isConnected()}
            rows={1}
            dir="auto"
          />
        </div>
      </div>
      <div class="prompt-input-hint">
        <PromptSelectors
          agent={<ModeSwitcher sessionID={sid} blocked={props.blocked?.() ?? false} hint={modeHint()} />}
          model={<ModelSelector sessionID={sid} blocked={props.blocked?.() ?? false} />}
          variant={<ThinkingSelector sessionID={sid} blocked={props.blocked?.() ?? false} />}
        />
        <div class="prompt-input-hint-actions">
          <div class="prompt-input-hint-pinned">
            <Show
              when={showStop()}
              fallback={
                <Tooltip value={sendLabel()} placement="top" openDelay={0}>
                  <IconButton
                    icon="send"
                    variant="ghost"
                    size="small"
                    onClick={() => void handleSend()}
                    disabled={!canSend()}
                    aria-label={sendLabel()}
                  />
                </Tooltip>
              }
            >
              <Tooltip value={stopLabel()} placement="top" openDelay={0}>
                <IconButton
                  icon="stop"
                  variant="ghost"
                  size="small"
                  onClick={() => session.abort()}
                  aria-label={language.t("prompt.action.stop")}
                />
              </Tooltip>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
