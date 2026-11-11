import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { JsonValue, ModelRef } from "@opencode/client"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { record, type ReviewCommentEntry } from "../../../src/shared/review-comments"
import { pushFixes } from "../../agent-manager/pr/pr-push-fixes"
import { fold, reserve } from "../components/chat/prompt-fold"
import { ReviewComments } from "../components/chat/ReviewComments"
import { SandboxButtonBase, SandboxTooltipContent } from "../components/shared/SandboxButton"
import { SpeechToTextButton } from "../components/speech-to-text/SpeechToTextButton"
import { createSpeechShortcut } from "../components/speech-to-text/shortcut"
import { useSpeechStatus } from "../components/speech-to-text/status"
import { useSpeechToText } from "../components/speech-to-text/useSpeechToText"
import { useLanguage } from "../context/language"
import { useIndexing } from "../context/indexing"
import { useVSCode } from "../context/vscode"
import {
  hasPopup,
  hasQuestionOption,
  hasTextSelection,
  isTextControl,
  ownsFocusRegion,
  promptFocusAllowed,
} from "../utils/focus"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import {
  browserPrompt,
  mergeBrowserReferences,
  partFeedback,
  type BrowserReference,
} from "../../../src/shared/browser-feedback"
import {
  registerAppend,
  registerReviewAppend,
  type AppendHandler,
  type ReferenceHandler,
  type ReviewAppendHandler,
} from "./append-ready"
import { BrowserReferences } from "./browser-references"
import type { PromptAttachment, SessionSearchItem } from "../../../src/protocol"
import { CodeContextChips } from "../components/chat/CodeContextChips"
import { ModelSelectorBase } from "../components/shared/ModelSelector"
import type { MentionFile } from "../hooks/context-mention-utils"
import { hasGitChangesMention } from "../hooks/git-changes-context-utils"
import { hasTerminalMention } from "../hooks/terminal-context-utils"
import { useFileMention } from "../hooks/useFileMention"
import { useGitChangesContext, type GitChangesTarget } from "../hooks/useGitChangesContext"
import { useImageAttachments } from "../hooks/useImageAttachments"
import { usePasteCollapse } from "../hooks/usePasteCollapse"
import { usePromptHistory } from "../hooks/usePromptHistory"
import { useTerminalContext } from "../hooks/useTerminalContext"
import { expandPastes, isPathMention } from "../components/chat/prompt-input-utils"
import { convertToMentionPath, insertPathMentions } from "../utils/path-mentions"
import { promptMentionOver, registerPromptMentionDrop, type WorktreeReference } from "../utils/prompt-mention-drop"
import { message, useV2 } from "./client"
import { registerComposer, type ComposerHandle } from "./composer"
import { MentionMenu } from "./mention-menu"
import { attachmentDrafts, imageAttachment, mergeAttachments, pasteDrafts } from "./prompt-attachments"
import { cleanEnhancedPrompt, enhancePromptRequest, normalizeEnhancePromptErrorMessage } from "./enhance-prompt"
import { insertSpacedText } from "./prompt-speech"
import { PromptOverflow, type OverflowItem } from "./prompt-overflow"
import { kiloSettings, runningDelivery } from "./kilo-settings"
import { composeReviewPrompt, mergePromptMetadata, mergeReviewComments } from "./review-drafts"
import { other, sendMode, sendShortcuts, type SendMode } from "./pending-actions"
import { PromptHint } from "./prompt-hint"
import { recommend, type ManagerContext } from "./shortcut-hint"
import { parseSlash, type SlashEntry } from "./slash"
import { createSlashMenu, SlashMenu } from "./slash-menu"

// Drafts live outside the component so a composer remounted for another session restores its own text, as v1 did.
// The key is the session id, or the pending tab id before a first prompt creates the session.
const drafts = new Map<string, string>()

// field-sizing grows the textarea from its content, so the composer needs no scrollHeight measurement.
const fieldSizing = typeof CSS !== "undefined" && CSS.supports("field-sizing", "content")

// Browser references picked for each draft, kept with the same key as the draft text.
const references = new Map<string, BrowserReference[]>()

// The toolbar fold measured by the last composer. A composer remounted for another session opens with it, so the
// actions keep the fold they had instead of showing every one for a frame and folding them away again.
let toolbarFold = { width: Number.POSITIVE_INFINITY, pinned: 0, slot: 26, reserve: 210 }

// Older review prompts carry the section in the text without review metadata.
const REVIEW_PREFIX = /^## Review Comments\n[\s\S]*?\n\n/

// Prompts Kilo composed on the user's behalf, such as a worktree update, are not the user's own history.
function injected(metadata: { [key: string]: JsonValue } | undefined): boolean {
  return typeof record(record(record(metadata)?.kilo)?.injected)?.title === "string"
}

// Pending review comments follow the same key as the text, so switching sessions neither loses nor mixes them.
const reviewDrafts = new Map<string, ReviewCommentEntry[]>()

// The exact `@` mentions of each draft. A path with spaces or a past-chat title cannot be found again from the text
// alone, so a draft keeps the tokens it had, with the same key as the text.
const mentionDrafts = new Map<string, { paths: string[]; sessions: SessionSearchItem[] }>()

// The `@` model entry opens a hidden model selector through its programmatic-open event, keyed to this trigger so the
// chat model selector and the slash command open are unaffected.
const MENTION_MODEL_TRIGGER = "mention-model"

function saveReviewDraft(key: string | undefined, comments: ReviewCommentEntry[]) {
  if (!key) return
  if (comments.length === 0) reviewDrafts.delete(key)
  else reviewDrafts.set(key, comments)
}

export const promptDrafts = {
  get(key: string | undefined) {
    return key ? (drafts.get(key) ?? "") : ""
  },
  set(key: string | undefined, value: string) {
    if (!key) return
    if (value) drafts.set(key, value)
    else drafts.delete(key)
  },
}

// Send keeps every icon it can show mounted and crossfades between them, so a modifier pressed and released quickly
// reverses the transition instead of restarting it.
const SEND_ICONS = ["send", "arrow-up", "clock", "arrow-right"] as const

const NO_KEYS = { altKey: false, ctrlKey: false, metaKey: false }

export function PromptInput(props: {
  session?: string
  /** Draft identity: the session id, or the pending tab id before a session exists. */
  draftKey?: string
  running: boolean
  disabled: boolean
  /** The model the composer shows; Enhance uses it so the rewrite never depends on another provider. */
  model?: ModelRef
  /** A pending permission blocks sending. Drives the blocked Send tooltip. */
  blocked?: boolean
  /** A pending question tool call. The composer waits for an answer, so Send replaces Stop. */
  questioning?: boolean
  /**
   * Sends the composed text. While the agent runs, `mode` chooses between steering, queueing and stopping to send now.
   * `input.items` are editor and terminal attachments, `input.files` the files the `@` mentions attach, and
   * `input.metadata` carries browser references.
   */
  onSend: (
    text: string,
    mode: SendMode,
    input?: { items?: PromptAttachment[]; files?: MentionFile[]; metadata?: { [key: string]: JsonValue } },
  ) => Promise<boolean>
  onStop: () => void
  /** Agent, model and variant controls, before the actions as in main's PromptInput. */
  selectors?: JSX.Element
  /** Auto-approve for permission requests. The toggle folds into the overflow menu like edge actions. */
  autoApprove?: { enabled: boolean; onToggle: () => void }
  /** Per-session sandbox confinement, or the new-session default while this composer is a draft. */
  sandbox?: {
    visible: () => boolean
    ready: () => boolean
    enabled: () => boolean
    available: () => boolean | undefined
    reason: () => string | undefined
    network: () => boolean
    disabled: () => boolean
    onToggle: () => void
  }
  /** Receives a function that appends text to the draft and, when `send` is true, sends it; undefined on unmount. */
  onAppendReady?: (append: AppendHandler | undefined) => void
  /** Receives a function that adds a browser reference to this draft; undefined on unmount. */
  onReferenceReady?: (add: ReferenceHandler | undefined) => void
  /** Receives a function that adds review comments to the draft; undefined on unmount. */
  onReviewAppendReady?: (append: ReviewAppendHandler | undefined) => void
  /** Receives the context actions handle of this composer; undefined on unmount. */
  onComposerReady?: (composer: ComposerHandle | undefined) => void
  /** The slash command menu: its entries, and the runner of a sent server command or skill. */
  slash?: {
    entries: () => SlashEntry[]
    run: (
      entry: SlashEntry,
      args: string,
      mode: SendMode,
      items: PromptAttachment[],
      files?: MentionFile[],
    ) => Promise<boolean>
  }
  /** Agent Manager worktrees the `@` menu can reference. The Worktrees entry is offered only when this is set. */
  worktrees?: Accessor<WorktreeReference[]>
  /** Whether the `@` menu offers Git changes. Defaults to true. */
  git?: () => boolean
  /** What `@git-changes` diffs. Defaults to the session's directory, whose base the host resolves. */
  gitTarget?: () => GitChangesTarget | undefined
  /** The Agent Manager worktree, or `local`, whose terminal `@terminal` reads. */
  terminalContext?: () => string | undefined
  /** Reads the focused Agent Manager terminal for `@terminal`; without it the host reads the VS Code terminal. */
  resolveEmbeddedTerminal?: (context?: string) => Promise<string | undefined>
  /** Opens the file a mention in the composer names. */
  onOpenFile?: (path: string) => void
  /** Another session tab is open, so switching tabs is one of the suggested shortcuts. */
  tabs?: boolean
  /** Agent Manager state for the suggested shortcut. Missing in the sidebar, which has no worktrees or panels. */
  manager?: () => ManagerContext | undefined
  /**
   * Whether this composer takes focus when it mounts for a new draft. The Agent Manager mounts one composer per
   * worktree and session, so that mount is v1's draft change; the sidebar does the same for its session tabs.
   */
  focusOnDraftChange?: () => boolean
  /** Receives each focus and blur, so the Agent Manager remembers that this context returns to the composer. */
  onFocusChange?: (focused: boolean) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const indexing = useIndexing()
  const [text, setText] = createSignal(promptDrafts.get(props.draftKey))
  const [browsers, setBrowsers] = createSignal(props.draftKey ? (references.get(props.draftKey) ?? []) : [])
  const keep = (key: string | undefined, list: BrowserReference[]) => {
    if (!key) return
    if (list.length) references.set(key, list)
    else references.delete(key)
  }
  const [comments, setComments] = createSignal(
    props.draftKey ? (reviewDrafts.get(props.draftKey) ?? []) : ([] as ReviewCommentEntry[]),
  )
  // The key the composer is editing, so a comment change lands in the right draft entry.
  let draft = props.draftKey
  const replaceComments = (next: ReviewCommentEntry[]) => {
    setComments(next)
    saveReviewDraft(draft, next)
  }
  const [sending, setSending] = createSignal(false)
  const [enhancing, setEnhancing] = createSignal(false)
  const slash = createSlashMenu(() => props.slash?.entries() ?? [])
  // Editor selections, files, terminal output and images sent with the next prompt, per draft like the text.
  const [attachments, setAttachments] = createSignal<PromptAttachment[]>(attachmentDrafts.get(props.draftKey))
  const paste = usePasteCollapse({ enabled: () => !props.disabled, text })
  paste.load(untrack(text), pasteDrafts.get(props.draftKey))
  // Shared across conversations unless the user opts in to a separate history per conversation.
  const scoped = () => kiloSettings()["experimental.conversationPromptHistory"] === true
  const history = usePromptHistory(
    () => props.draftKey,
    () => !scoped(),
  )
  // A loaded session contributes its user messages, so recall includes prompts sent before this composer mounted.
  // Compare the texts, not the message list, so assistant streaming does not seed again on every update.
  const sessionHistory = createMemo(
    () => {
      const id = props.session
      if (!id) return []
      return v2.data.session.message.list(id).flatMap((item) => {
        if (item.type !== "user" || injected(item.metadata)) return []
        const value = partFeedback(item.metadata, item.text)?.body ?? item.text.replace(REVIEW_PREFIX, "")
        return value.trim() ? [value] : []
      })
    },
    undefined,
    { equals: (left, right) => left.length === right.length && left.every((value, index) => value === right[index]) },
  )
  createEffect(() => {
    const texts = sessionHistory()
    if (texts.length > 0) history.seed(texts)
  })
  const images = useImageAttachments()
  // The hook reads files; the composer keeps one list, so a finished read moves into it.
  createEffect(() => {
    const read = images.images()
    if (read.length === 0) return
    setAttachments((current) => mergeAttachments(current, read.map(imageAttachment)))
    images.clear()
  })
  // Files dropped from the Explorer or an editor tab become `@` mentions at the caret. A drop does not fire the
  // textarea input event, so it invalidates a pending Enhance itself, as every other programmatic insert does.
  images.setFilePathDropHandler((paths) => {
    const ref = refs.input
    if (props.disabled || !ref) return
    enhanceToken++
    preEnhance = null
    history.reset()
    const resolved = paths.map((path) => convertToMentionPath(path, v2.directory))
    const result = insertPathMentions(ref.value, ref.selectionStart ?? ref.value.length, resolved)
    ref.value = result.text
    setText(result.text)
    mention.addPaths(resolved, v2.directory)
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
  })
  const removeAttachment = (id: string) => setAttachments((current) => current.filter((item) => item.id !== id))
  const pictures = () => attachments().filter((item) => item.kind === "image")
  const contexts = () => attachments().filter((item) => item.kind !== "image")
  // The draft Enhance replaced, so Ctrl/Cmd+Z restores it once.
  let preEnhance: string | null = null
  let preEnhancePastes: string[] = []
  // Ignores a late result after a newer Enhance or a newer edit.
  let enhanceToken = 0
  const refs = {
    input: undefined as HTMLTextAreaElement | undefined,
    overlay: undefined as HTMLDivElement | undefined,
    container: undefined as HTMLDivElement | undefined,
    mention: undefined as HTMLDivElement | undefined,
  }
  const vscode = useVSCode()
  // `@` mentions: files, folders, terminal output, git changes, past chats, models and worktrees.
  const modelKeys = createMemo(
    () => new Set((v2.data.location.model.list() ?? []).map((model) => `${model.providerID}/${model.id}`)),
  )
  const git = () => props.git?.() ?? true
  const mention = useFileMention(
    vscode,
    () => props.session ?? props.draftKey,
    git,
    props.worktrees,
    modelKeys,
    () => v2.directory,
  )
  // The Browse files dialog answers through the host; the picked path replaces the `@` query it was opened from.
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type === "filePickerResult") mention.insertFilePickerResult(message.path, message.requestId)
    }),
  )
  const terminal = useTerminalContext(props.resolveEmbeddedTerminal)
  const changes = useGitChangesContext(vscode, () => props.gitTarget?.() ?? { directory: v2.directory }, git)
  // Picking the `@` model entry opens the hidden model selector below. The selector owns its open state, so the
  // mention closes at once and dismissing the selector cannot leave the menu stuck open.
  createEffect(() => {
    if (!mention.modelPicker()) return
    mention.closeMention()
    window.dispatchEvent(new CustomEvent("openModelPicker", { detail: { source: MENTION_MODEL_TRIGGER } }))
  })
  const highlightMentions = () => {
    const paths = new Set(mention.mentionedPaths())
    for (const token of mention.mentionedSessions().keys()) paths.add(token)
    for (const token of mention.mentionedModels()) paths.add(token)
    if (hasTerminalMention(text())) paths.add("terminal")
    if (git() && hasGitChangesMention(text())) paths.add("git-changes")
    return paths
  }
  // Model references are inline text, not files, so they are neither styled nor opened like path mentions.
  const isModelMention = (value: string) => mention.mentionedModels().has(value.replace(/^@/, ""))
  const scrollMention = () => {
    const active = refs.mention?.querySelectorAll(".file-mention-item")[mention.mentionIndex()]
    if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" })
  }
  const saveMentions = (key: string | undefined) => {
    if (!key) return
    const paths = [...mention.mentionedPaths()]
    const sessions = [...mention.mentionedSessions()].map(([token, session]) => ({ ...session, title: token }))
    if (paths.length || sessions.length) mentionDrafts.set(key, { paths, sessions })
    else mentionDrafts.delete(key)
  }
  // A restored draft finds its mentions again: the saved tokens first, then any path the text spells out.
  const seedMentions = (key: string | undefined, value: string) => {
    mention.closeMention()
    mention.seedFromText(value)
    const saved = key ? mentionDrafts.get(key) : undefined
    if (!saved) return
    mention.seedFromParts(saved.paths, value)
    mention.seedSessions(saved.sessions, value)
  }
  seedMentions(props.draftKey, untrack(text))
  /**
   * The files the mentions in `value` attach. `@terminal` and `@git-changes` are read now, so a failed read keeps
   * the draft instead of sending a prompt without the context it names. The file and past-chat mentions are read
   * before the first await, while the composer still holds them.
   */
  const mentionFiles = async (value: string): Promise<MentionFile[] | undefined> => {
    const known = mention.parseFileAttachments(value)
    const output = await terminal
      .resolveAttachment(value, props.session, props.terminalContext?.())
      .catch((err: Error) => {
        showToast({
          variant: "error",
          title: language.t("prompt.mention.terminalUnavailable"),
          description: err.message,
        })
        return undefined
      })
    if (hasTerminalMention(value) && !output) return undefined
    const diff = await changes.resolveAttachment(value).catch((err: Error) => {
      showToast({
        variant: "error",
        title: language.t("prompt.mention.gitChangesUnavailable"),
        description: err.message,
      })
      return undefined
    })
    if (git() && hasGitChangesMention(value) && !diff) return undefined
    return [...known, ...(output ? [output] : []), ...(diff ? [diff] : [])]
  }
  const speech = useSpeechToText(
    vscode,
    { goToLogin: () => vscode.postMessage({ type: "openProfile" }) },
    language,
    showToast,
  )
  const speechStatus = useSpeechStatus()
  const canUseSpeech = () => speechStatus.status().enabled
  // Recording is enough to send: the transcript arrives first and the send continues from it. No other speech state
  // may send, or a draft would leave before the transcript is ready and the transcript would become a draft.
  const ready = () =>
    !props.disabled &&
    !props.blocked &&
    !sending() &&
    images.pending() === 0 &&
    !terminal.pending() &&
    !changes.pending()
  const canSend = () =>
    ready() &&
    (speech.state() === "recording" ||
      (!speech.active() &&
        (!!text().trim() || attachments().length > 0 || browsers().length > 0 || comments().length > 0)))
  // The label is the pending-permission hint while blocked, otherwise Send.
  const sendLabel = () => {
    if (props.blocked) return language.t("prompt.action.send.blocked")
    if (speech.state() === "recording") return language.t("prompt.action.send.recording")
    return language.t("prompt.action.send")
  }
  // While the agent runs, a held modifier previews its send action on the Send button, so the user sees what Enter or
  // a click will do before pressing it. The accessible name stays "Send". The modifiers are kept rather than the
  // action, so changing what Enter does in the settings updates the preview at once.
  const [held, setHeld] = createSignal<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">>(NO_KEYS)
  const hold = (event: KeyboardEvent) =>
    setHeld({ altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })
  const release = () => setHeld(NO_KEYS)
  onMount(() => {
    window.addEventListener("keydown", hold)
    window.addEventListener("keyup", hold)
    window.addEventListener("blur", release)
  })
  onCleanup(() => {
    window.removeEventListener("keydown", hold)
    window.removeEventListener("keyup", hold)
    window.removeEventListener("blur", release)
  })
  // The empty composer suggests one shortcut in its placeholder: the one that fits what the user does now. The Send
  // tooltip and the modifier preview cover the other send actions, and the Agent Manager list covers the rest.
  const [focused, setFocused] = createSignal(false)
  // Focus away in an editor or terminal is what makes "add the selection" and "type here" the useful hints.
  const [away, setAway] = createSignal(!document.hasFocus())
  const onWindowFocus = () => setAway(false)
  const onWindowBlur = () => setAway(true)
  window.addEventListener("focus", onWindowFocus)
  window.addEventListener("blur", onWindowBlur)
  onCleanup(() => {
    window.removeEventListener("focus", onWindowFocus)
    window.removeEventListener("blur", onWindowBlur)
  })
  // One memo for every reader, so the placeholder and the keycap copy share one recommendation instead of rebuilding
  // the Agent Manager context once per reader.
  const suggestion = createMemo(
    () => {
      if (kiloSettings()["showShortcutHints"] === false) return undefined
      if (props.disabled || v2.connection.status() !== "connected") return undefined
      // A recording prompt sends on the next Enter, so it suggests nothing else.
      if (speech.state() === "recording") return undefined
      // While the agent runs, the hint teaches the delivery Enter does not do.
      const alternate = other(runningDelivery())
      return recommend({
        bindings: v2.bindings(),
        alternate: { binding: sendShortcuts(runningDelivery())[alternate], label: alternate },
        focused: focused(),
        away: away(),
        draft: !!text(),
        // A pending question is not running work, so it does not offer queueing.
        busy: props.running && !props.questioning,
        selection: v2.selection(),
        tabs: props.tabs,
        // A thunk: a hidden hint must not build the Agent Manager context.
        manager: props.manager,
      })
    },
    undefined,
    { equals: (a, b) => a?.label === b?.label && a?.binding === b?.binding },
  )
  // The placeholder template split around the key, so the key renders as keycaps.
  const keycaps = createMemo(
    () => {
      const next = suggestion()
      if (!next) return undefined
      const mark = "\u0001"
      const parts = language
        .t("prompt.placeholder.plainHint", { key: mark, action: language.t(`prompt.shortcutHint.${next.label}`) })
        .split(mark)
      return { before: parts.at(0) ?? "", after: parts.at(1) ?? "", binding: next.binding }
    },
    undefined,
    // Recreate the overlay only when the visible tip changes, so its fade-in runs once per tip.
    { equals: (a, b) => a?.before === b?.before && a?.after === b?.after && a?.binding === b?.binding },
  )
  // The keycap copy above draws the suggested shortcut, so the native placeholder stays the plain help text. An empty
  // textarea is sized from its placeholder, so a shorter hint here would resize the composer every time it appears.
  const placeholder = () =>
    v2.connection.status() === "connected"
      ? language.t("prompt.placeholder.plain")
      : language.t("prompt.placeholder.connecting")
  const busySend = () => props.running && !props.blocked && speech.state() !== "recording"
  const sendAction = (): SendMode => (busySend() ? sendMode(held(), true, runningDelivery()) : "steer")
  // While the agent runs, Send draws the icon the pending prompt rows use for its action: the steer arrow ("join this
  // turn") or the clock ("after this turn"). The other delivery is ⌥↵, previewed here, or the pending row's controls.
  const sendIcon = () =>
    busySend() ? ({ steer: "arrow-up", queue: "clock", now: "arrow-right" } as const)[sendAction()] : "send"
  // While the agent runs, the tooltip names what Send does now and its key, like the other composer tooltips. Holding a
  // modifier switches it to that action; the placeholder suggests the other delivery.
  const sendHint = () => {
    if (!busySend()) return sendLabel()
    const action = sendAction()
    return (
      <div data-slot="tooltip-keybind">
        <span>{language.t(action === "now" ? "prompt.action.stopAndSend" : `prompt.action.${action}`)}</span>
        <span data-slot="tooltip-keybind-key">{sendShortcuts(runningDelivery())[action]}</span>
      </div>
    )
  }
  // Stop replaces Send while the agent runs and the draft is empty. Typing during a run turns it back into Send,
  // whose prompt steers the running turn at its next step. A pending question is not running work. Stop is not shown
  // while the prompt is still being admitted, because an unadmitted prompt has no execution for Stop to interrupt.
  const showStop = () =>
    props.running &&
    !text().trim() &&
    !browsers().length &&
    attachments().length === 0 &&
    comments().length === 0 &&
    !props.questioning &&
    speech.state() !== "recording"

  const scroll = () => {
    if (!refs.input || !refs.overlay) return
    refs.overlay.scrollTop = refs.input.scrollTop
    refs.overlay.scrollLeft = refs.input.scrollLeft
  }

  // Switching drafts saves the text of the draft being left and restores the target draft. SessionView normally
  // remounts this component for another key; this also covers a key change without a remount.
  createEffect(
    on(
      () => props.draftKey,
      (key) => {
        if (key === draft) return
        promptDrafts.set(draft, untrack(text))
        untrack(() => saveMentions(draft))
        attachmentDrafts.set(draft, untrack(attachments))
        pasteDrafts.set(
          draft,
          untrack(paste.pastes).map((item) => item.text),
        )
        keep(draft, untrack(browsers))
        saveReviewDraft(draft, untrack(comments))
        draft = key
        history.reset()
        slash.close()
        setBrowsers(key ? (references.get(key) ?? []) : [])
        setComments((key ? reviewDrafts.get(key) : undefined) ?? [])
        const value = promptDrafts.get(key)
        enhanceToken++
        preEnhance = null
        setText(value)
        paste.load(value, pasteDrafts.get(key))
        untrack(() => seedMentions(key, value))
        setAttachments(attachmentDrafts.get(key))
        if (refs.input) {
          refs.input.value = value
          refs.input.scrollTop = 0
        }
        scroll()
      },
    ),
  )
  onCleanup(() => {
    promptDrafts.set(draft, text())
    saveMentions(draft)
    attachmentDrafts.set(draft, attachments())
    pasteDrafts.set(
      draft,
      paste.pastes().map((item) => item.text),
    )
    keep(draft, browsers())
    saveReviewDraft(draft, comments())
  })

  // kilocode_change start: batch the auto-height pass into one frame. Reading
  // scrollHeight after a height write forces a synchronous layout on every
  // keystroke, so the measurement waits for the frame and only writes a height
  // that changed. Browsers with field-sizing size the textarea from CSS alone.
  let fitFrame: number | undefined
  let fitted = 0
  let firstFit = true
  const fit = () => {
    const input = refs.input
    if (!input) return
    if (!fieldSizing) {
      const previous = input.style.height
      input.style.height = "auto"
      // As in main: size to the content, which includes a wrapped placeholder.
      const height = Math.min(input.scrollHeight, 200)
      if (height === fitted && previous) input.style.height = previous
      else {
        fitted = height
        input.style.height = `${height}px`
      }
    }
    scroll()
  }
  createEffect(() => {
    text()
    if (!refs.input) return
    if (firstFit) {
      firstFit = false
      fit()
      return
    }
    if (fitFrame !== undefined) return
    fitFrame = requestAnimationFrame(() => {
      fitFrame = undefined
      fit()
    })
  })
  onCleanup(() => {
    if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
  })
  // kilocode_change end

  const focusInput = () => refs.input?.focus({ preventScroll: true })
  // A menu selection rewrites the draft like an edit, so a late Enhance result cannot overwrite it.
  const replaceDraft = (value: string, cursor: number) => {
    enhanceToken++
    preEnhance = null
    history.reset()
    setText(value)
    const input = refs.input
    if (!input) return
    input.value = value
    input.setSelectionRange(cursor, cursor)
    focusInput()
  }
  // The restore chain outlives the event that started it, so every handle is tracked and dropped on unmount.
  const frames = new Set<number>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false
  const frame = (run: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      if (!disposed) run()
    })
    frames.add(id)
  }
  const timer = (run: () => void, delay: number) => {
    const id = setTimeout(() => {
      timers.delete(id)
      if (!disposed) run()
    }, delay)
    timers.add(id)
  }
  // A restore retries after the dialog, menu or question that owned focus closes, but never takes focus from
  // another text control, a popup or a selection.
  const onFocusPrompt = (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as Record<string, unknown> | undefined) : undefined
    const force = detail?.force === true
    const allowed = () =>
      !disposed &&
      !!refs.input?.isConnected &&
      promptFocusAllowed({
        force,
        deferToQuestion: detail?.deferFocusToQuestion === true,
        questionOption: hasQuestionOption(),
        ownsRegion: ownsFocusRegion(document.activeElement),
        popup: hasPopup(),
        textControl: document.activeElement !== refs.input && isTextControl(document.activeElement),
        selection: hasTextSelection(),
      })
    const focus = () => {
      if (!allowed()) return
      focusInput()
    }
    focus()
    if (detail?.restore !== true) return
    const restore = () => {
      if (!allowed()) return
      window.focus()
      focus()
    }
    queueMicrotask(restore)
    frame(() => {
      restore()
      frame(restore)
      timer(restore, 0)
      timer(restore, 50)
    })
  }
  onMount(() => window.addEventListener("focusPrompt", onFocusPrompt))
  // v1 focused the prompt from its draft-change effect. This composer is remounted per draft instead, so mounting for
  // a switched worktree or session is that event: ask the owner whether this context keeps focus, for example on a
  // visible terminal, then take it once this composer exists. Like v1, this is one immediate attempt with no restore
  // chain, so a surface that moves focus on purpose afterwards, such as the tab strip under arrow keys, keeps it.
  // The request runs after the listener above so the new composer receives it, and only while its window has focus.
  onMount(() => {
    if (!document.hasFocus() || hasQuestionOption()) return
    if (props.focusOnDraftChange?.() !== true) return
    window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { deferFocusToQuestion: true } }))
  })
  // Session tabs, worktree cards, terminal tabs, diff headers and document tabs drop as a mention at the caret.
  onMount(() => {
    registerPromptMentionDrop(refs.container, (drop) => {
      const ref = refs.input
      if (!ref || !ref.isConnected || props.disabled) return false
      return mention.insertDrop(drop, ref, setText, v2.directory)
    })
    onCleanup(() => registerPromptMentionDrop(undefined, undefined))
  })
  onCleanup(() => {
    disposed = true
    for (const id of frames) cancelAnimationFrame(id)
    for (const id of timers) clearTimeout(id)
    frames.clear()
    timers.clear()
    window.removeEventListener("focusPrompt", onFocusPrompt)
  })

  const insertSpeechText = (value: string) => {
    const ref = refs.input
    const current = text()
    const start = ref?.selectionStart ?? current.length
    const end = ref?.selectionEnd ?? start
    const result = insertSpacedText(current, value, start, end)
    enhanceToken++
    preEnhance = null
    history.reset()
    setText(result.text)
    if (!ref) return
    ref.value = result.text
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
  }

  const startSpeech = () => {
    speech.start({ model: speechStatus.status().model, insert: insertSpeechText })
  }

  const transcribeAndSend = () => {
    const value = text()
    const session = props.session
    speech.stop({
      done: () => void submit(),
      ready: () => props.session === session && text() === value,
    })
  }

  // A context action sends its own prompt. It keeps the composer guards and returns its text and chips to the
  // draft when the composer cannot send or the send fails, so the request is never lost.
  const putInDraft = (value: string, items: PromptAttachment[]) => {
    const current = text()
    history.reset()
    const next = current.trim() ? `${current}\n\n${value}` : value
    setText(next)
    mention.seedFromText(next)
    setAttachments((list) => mergeAttachments(list, items))
    window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { force: true, restore: true } }))
  }

  // Empties the composer once a draft is sent. Its mentions go with it, so a failed send restores them from the text.
  const clearDraft = (key: string | undefined) => {
    setText("")
    paste.load("", [])
    setAttachments([])
    setBrowsers([])
    replaceComments([])
    slash.close()
    mention.closeMention()
    if (key) mentionDrafts.delete(key)
  }

  const submit = (
    external?: { text: string; items: PromptAttachment[]; metadata?: { [key: string]: JsonValue } },
    mode: SendMode = "steer",
  ) => {
    if (!ready() || (speech.active() && speech.state() !== "recording")) {
      if (external) putInDraft(external.text, external.items)
      return
    }
    if (!external && !canSend()) return
    const draft = text()
    // Capture the paste ranges before the draft is cleared, so a mismatched placeholder count still expands the
    // blocks that have backing text.
    const pastes = paste.pastes()
    const backing = pastes.map((item) => item.text)
    const items = external ? external.items : attachments()
    const picked = external ? [] : browsers()
    // A context action sends its own text; pending review comments stay in the draft for the user's next prompt.
    const pending = external ? [] : comments()
    const prompt = browserPrompt(draft, picked)
    const sent = external ? external.text : expandPastes(draft, pastes).trim()
    // A draft that names a server command or skill runs it. Review comments and browser references need the plain
    // prompt, which carries them in its text and metadata.
    const runner = external || pending.length > 0 || picked.length > 0 ? undefined : props.slash
    const target = runner ? parseSlash(runner.entries(), sent) : undefined
    // The draft key identifies the conversation this send belongs to, even when the session is created first.
    const key = props.draftKey
    // Clear the draft as soon as it is sent, so the composer is empty while the prompt is admitted. Restore it only
    // if the send fails and the user has not typed, attached or picked something new.
    const restore = () => {
      if (external) return putInDraft(external.text, external.items)
      if (text().trim() || attachments().length > 0 || browsers().length > 0 || comments().length > 0) return
      setText(draft)
      paste.load(draft, backing)
      mention.seedFromText(draft)
      setAttachments(items)
      setBrowsers(picked)
      replaceComments(pending)
    }
    // The review Markdown leads the text, so the transcript can strip it again with the comments in metadata.
    const review = external
      ? { text: external.text, metadata: external.metadata }
      : composeReviewPrompt(pending, expandPastes(draft, pastes), pushFixes())
    // The mentions are located in the text that is sent, so the transcript can highlight each one in place. They are
    // read before the draft is cleared, while the composer still knows them.
    const located = target ? sent : review.text
    const pendingFiles = external ? Promise.resolve<MentionFile[]>([]) : mentionFiles(located)
    if (!external) clearDraft(key)
    setSending(true)
    const request = pendingFiles.then((files) => {
      // A mention whose context could not be read keeps the draft for another try.
      if (!files) return false
      if (runner && target) return runner.run(target.entry, target.args, mode, items, files)
      // The references and review data hold only strings, numbers and arrays, so they are prompt metadata.
      return props.onSend(review.text, mode, {
        items,
        files,
        metadata: mergePromptMetadata(prompt.metadata as { [key: string]: JsonValue } | undefined, review.metadata),
      })
    })
    void request
      .then((ok) => {
        if (ok) preEnhance = null
        else restore()
        if (!ok || external) return
        history.append(sent, key)
        history.reset()
      })
      .catch((err: unknown) => {
        v2.report(err)
        restore()
      })
      .finally(() => setSending(false))
  }

  // A typed client action runs in the webview without a send, and leaves the attachments in the draft.
  const runAction = () => {
    if (!props.slash || speech.active() || comments().length > 0 || browsers().length > 0) return false
    const target = parseSlash(props.slash.entries(), paste.plainText(text()).trim())
    if (target?.entry.kind !== "action") return false
    slash.close()
    replaceDraft("", 0)
    target.entry.run()
    return true
  }

  const send = (mode: SendMode = "steer") => {
    if (runAction()) return
    if (!canSend()) return
    if (speech.state() === "recording") {
      transcribeAndSend()
      return
    }
    submit(undefined, mode)
  }

  registerComposer(props.onComposerReady, {
    attach: (items) => {
      setAttachments((current) => mergeAttachments(current, items))
      window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { force: true, restore: true } }))
    },
    // A context action sends on its own and leaves the draft and its chips for the user's next prompt.
    submit: (value, items, metadata) => submit({ text: value, items, metadata }),
  })

  registerAppend(props.onAppendReady, (value, shouldSend) => {
    const current = text()
    enhanceToken++
    preEnhance = null
    history.reset()
    const next = current.trim() ? `${current}\n\n${value}` : value
    setText(next)
    mention.seedFromText(next)
    if (shouldSend) send()
    else focusInput()
  })

  // Merges comments into the current draft and sends them at once when the composer was otherwise empty, as v1 did.
  const appendComments = (incoming: ReviewCommentEntry[], shouldSend: boolean) => {
    if (incoming.length === 0) return
    const empty = !text().trim() && attachments().length === 0 && browsers().length === 0 && comments().length === 0
    replaceComments(mergeReviewComments(comments(), incoming))
    if (shouldSend && empty) send()
  }

  registerReviewAppend(props.onReviewAppendReady, appendComments)

  // A reference for another session is dropped: the browser tab can outlive the session the composer shows.
  registerAppend<ReferenceHandler>(props.onReferenceReady, (reference) => {
    if (props.session && reference.sessionId !== props.session) return
    setBrowsers((current) => mergeBrowserReferences(current, reference))
    focusInput()
  })

  const shortcut = createSpeechShortcut({
    speech,
    disabled: () => !canUseSpeech() || props.disabled,
    start: startSpeech,
    finish: (shouldSubmit) => {
      if (shouldSubmit) {
        transcribeAndSend()
        return
      }
      speech.stop()
    },
  })
  const speechDown = (event: KeyboardEvent): boolean => {
    if (!shortcut.down(event)) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const speechUp = (event: KeyboardEvent): boolean => {
    if (!shortcut.up(event)) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  onCleanup(shortcut.reset)

  // Blocked while a send is in flight, so the composer is never rewritten from under a pending submission.
  const canEnhance = () => !props.running && !props.disabled && !enhancing() && !sending()

  const enhance = () => {
    if (!canEnhance()) return
    const draft = paste.plainText(text()).trim()
    // An empty draft explains the action instead of rewriting nothing.
    if (!draft) {
      setText(language.t("prompt.action.enhanceDescription"))
      focusInput()
      return
    }
    preEnhance = text()
    preEnhancePastes = paste.pastes().map((item) => item.text)
    const token = ++enhanceToken
    setEnhancing(true)
    void v2.api.generate
      .text({ prompt: enhancePromptRequest(draft), model: props.model })
      .then((response) => {
        if (token !== enhanceToken) return
        const next = cleanEnhancedPrompt(response.text)
        setText(next)
        paste.load(next, [])
        mention.seedFromText(next)
        focusInput()
      })
      .catch((err: unknown) => {
        if (token !== enhanceToken) return
        v2.report(new Error(normalizeEnhancePromptErrorMessage(message(err))))
      })
      .finally(() => {
        // Clear unconditionally: an edit invalidates the token, and two Enhance requests cannot overlap
        // because canEnhance() blocks while enhancing() is true.
        setEnhancing(false)
      })
  }

  // VS Code's webview preload forwards Ctrl/Cmd+Z to the workbench, so the keydown must stop it. Only an
  // Enhance result is reverted here; any other undo keeps its native behavior.
  const undoKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const z = e.keyCode === 90 || e.key.toLowerCase() === "z"
    const y = e.keyCode === 89 || e.key.toLowerCase() === "y"
    if (z) return e.shiftKey ? "redo" : "undo"
    if (y && !e.shiftKey) return "redo"
  }

  const undoEnhance = (e: KeyboardEvent) => {
    if (preEnhance === null || undoKey(e) !== "undo") return false
    e.preventDefault()
    e.stopPropagation()
    const restored = preEnhance
    preEnhance = null
    setText(restored)
    paste.load(restored, preEnhancePastes)
    mention.seedFromText(restored)
    return true
  }

  // Arrow Up/Down at a cursor boundary cycles through sent prompts, keeping the current draft.
  const historyKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return false
    if (props.disabled || sending()) return false
    const input = refs.input
    if (!input) return false
    const cursor = input.selectionStart ?? 0
    if (cursor !== (input.selectionEnd ?? cursor)) return false
    const direction = event.key === "ArrowUp" ? ("up" as const) : ("down" as const)
    const entry = history.navigate(
      direction,
      text(),
      cursor,
      paste.pastes().map((item) => item.text),
    )
    if (!entry) return false
    enhanceToken++
    preEnhance = null
    event.preventDefault()
    setText(entry.text)
    paste.load(entry.text, entry.pastes)
    input.value = entry.text
    const pos = direction === "up" ? 0 : entry.text.length
    input.setSelectionRange(pos, pos)
    return true
  }

  // Progressive toolbar fold, driven by the toolbar width and font size only.
  // The list goes from low to high priority, so low priority actions fold first
  // and the actions next to voice and send stay in place. All sizes are read
  // from the DOM, so a larger font scales the fold steps.
  let hintRef: HTMLDivElement | undefined
  let pinnedRef: HTMLDivElement | undefined
  const [metrics, setMetrics] = createSignal(toolbarFold, {
    equals: (a, b) => a.width === b.width && a.pinned === b.pinned && a.slot === b.slot && a.reserve === b.reserve,
  })
  const [measured, setMeasured] = createSignal(false)
  onMount(() => {
    const measure = () => {
      const hint = hintRef
      const pinned = pinnedRef
      if (!hint || !pinned) return
      const box = getComputedStyle(hint)
      const width =
        hint.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight) - (parseFloat(box.columnGap) || 0)
      // A composer mounted in a hidden panel measures nothing, so it keeps the fold it opens with until it has room.
      if (width <= 0) return
      const actions = pinned.parentElement
      const button = actions?.querySelector<HTMLElement>(".prompt-action [data-component='icon-button']")
      const gap = actions ? parseFloat(getComputedStyle(actions).columnGap) || 0 : 0
      toolbarFold = {
        width,
        pinned: pinned.getBoundingClientRect().width,
        slot: (button?.getBoundingClientRect().width ?? 22) + gap,
        reserve: reserve(hint),
      }
      setMetrics(toolbarFold)
      setMeasured(true)
    }
    // Measure once before the first paint. The observer only reports after it, which would expand the actions the
    // cached fold held back and animate them into the overflow menu on every switch.
    measure()
    const observer = new ResizeObserver(measure)
    if (hintRef) observer.observe(hintRef)
    if (pinnedRef) observer.observe(pinnedRef)
    onCleanup(() => observer.disconnect())
  })
  const openIndexingSettings = () => vscode.postMessage({ type: "openSettingsTab", tab: "indexing" })
  const indexingAction = (): OverflowItem => {
    const tone = indexing.tone()
    return {
      key: "indexing",
      icon: "database",
      label: language.t("prompt.action.indexing"),
      description: indexing.status().message || indexing.label(),
      tone: tone === "muted" ? undefined : tone,
      dot: tone === "muted" ? undefined : tone,
      run: openIndexingSettings,
    }
  }
  const foldable = createMemo<OverflowItem[]>(() => {
    const list: OverflowItem[] = indexing.buttonVisible() ? [indexingAction()] : []
    const sandbox = props.sandbox
    if (sandbox?.visible())
      list.push({
        key: "sandbox",
        icon: "lock",
        label: language.t(sandbox.enabled() ? "prompt.action.sandbox.disable" : "prompt.action.sandbox.enable"),
        description:
          sandbox.ready() && sandbox.available() === false
            ? (sandbox.reason() ?? language.t("common.requestFailed"))
            : undefined,
        disabled: sandbox.disabled(),
        tone: sandbox.enabled() ? "success" : undefined,
        dot: sandbox.enabled() ? "success" : undefined,
        run: sandbox.onToggle,
      })
    list.push({
      key: "enhance",
      icon: "wand-sparkles",
      label: language.t("prompt.action.enhance"),
      disabled: !canEnhance(),
      busy: enhancing(),
      run: enhance,
    })
    const autoApprove = props.autoApprove
    if (autoApprove)
      list.push({
        key: "approve",
        icon: "shield",
        label: language.t(
          autoApprove.enabled ? "prompt.action.autoApprove.disable" : "prompt.action.autoApprove.enable",
        ),
        description: language.t("prompt.action.autoApprove.sandboxExcluded"),
        tone: autoApprove.enabled ? "success" : undefined,
        dot: autoApprove.enabled ? "success" : undefined,
        run: autoApprove.onToggle,
      })
    return list
  })
  const shown = createMemo(() => fold({ ...metrics(), count: foldable().length }))
  const hidden = createMemo(() => foldable().slice(0, foldable().length - shown()))
  const folded = (key: string) => hidden().some((item) => item.key === key)
  const approveTooltip = () => {
    const autoApprove = props.autoApprove
    if (!autoApprove) return ""
    return `${language.t(
      autoApprove.enabled ? "prompt.action.autoApprove.enabled" : "prompt.action.autoApprove.disabled",
    )} ${language.t("prompt.action.autoApprove.sandboxExcluded")}`
  }

  return (
    <div
      ref={(el) => (refs.container = el)}
      class="prompt-input-container"
      classList={{
        "prompt-input-container--dragging": images.dragging(),
        "prompt-input-container--mention-drop": promptMentionOver(),
      }}
      onDragOver={images.handleDragOver}
      onDragLeave={images.handleDragLeave}
      onDrop={images.handleDrop}
    >
      <Show when={slash.show()}>
        <SlashMenu menu={slash} onSelect={(entry) => slash.select(entry, text(), replaceDraft)} />
      </Show>
      <div class="mention-model-anchor" aria-hidden="true">
        <ModelSelectorBase
          models={v2.data.location.model.list()}
          providers={v2.data.location.provider.list()}
          gateway={v2.kiloModels().entries}
          value={null}
          trigger={MENTION_MODEL_TRIGGER}
          collapsed
          blocked={props.disabled}
          onSelect={(providerID, modelID) => {
            if (providerID && modelID) mention.selectModelReference(providerID, modelID)
          }}
          onCancel={() => {
            mention.closeMention()
            focusInput()
          }}
        />
      </div>
      <Show when={mention.showMention()}>
        <MentionMenu
          mention={mention}
          ref={(el) => (refs.mention = el)}
          onSelect={(item) => {
            if (refs.input) mention.selectMention(item, refs.input, setText)
          }}
          onSession={(picked) => {
            if (refs.input) mention.selectSession(picked, refs.input, setText)
          }}
          onWorktree={(picked) => {
            if (refs.input) mention.selectWorktree(picked, refs.input, setText)
          }}
          onClose={() => {
            mention.closeMention()
            focusInput()
          }}
        />
      </Show>
      <Show when={comments().length > 0 && !props.disabled}>
        <ReviewComments
          comments={comments()}
          sessionID={props.session}
          onRemove={(id) => replaceComments(comments().filter((item) => item.id !== id))}
          onClear={() => replaceComments([])}
        />
      </Show>
      <Show when={browsers().length > 0}>
        <div data-component="browser-references">
          <BrowserReferences
            references={browsers()}
            onRemove={(id) => {
              if (!props.disabled) setBrowsers((current) => current.filter((item) => item.id !== id))
            }}
            onClear={() => {
              if (!props.disabled) setBrowsers([])
            }}
          />
        </div>
      </Show>
      <Show when={contexts().length > 0}>
        <CodeContextChips
          items={contexts()}
          disabled={props.disabled}
          onRemove={removeAttachment}
          onClear={() => setAttachments(pictures())}
        />
      </Show>
      <Show when={pictures().length > 0}>
        <div class="image-attachments">
          <For each={pictures()}>
            {(img) => (
              <div class="image-attachment">
                <img
                  src={img.uri}
                  alt={img.name}
                  title={img.name}
                  onClick={() => vscode.postMessage({ type: "previewImage", dataUrl: img.uri, filename: img.name })}
                />
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  size="small"
                  class="image-attachment-remove"
                  disabled={props.disabled}
                  onClick={() => removeAttachment(img.id)}
                  aria-label={language.t("ui.promptInput.removeAttachment")}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" ref={(el) => (refs.overlay = el)} aria-hidden="true" dir="auto">
            <For each={paste.segments(text(), highlightMentions())}>
              {(seg) => (
                <Show
                  when={seg.kind === "paste"}
                  fallback={
                    <Show when={seg.kind === "mention"} fallback={<span>{seg.text}</span>}>
                      <span
                        class="prompt-input-file-mention"
                        classList={{
                          "prompt-input-file-mention--file": isPathMention(seg.text) && !isModelMention(seg.text),
                        }}
                        onClick={(e) => {
                          if (!isPathMention(seg.text) || isModelMention(seg.text)) return
                          // A past chat opens from the sent message, not from the draft.
                          if (mention.mentionedSessions().has(seg.text.replace(/^@/, ""))) return
                          e.preventDefault()
                          e.stopPropagation()
                          props.onOpenFile?.(seg.text.replace(/^@/, ""))
                        }}
                      >
                        {seg.text}
                      </span>
                    </Show>
                  }
                >
                  <span
                    class="prompt-input-paste"
                    title={language.t("prompt.paste.expand")}
                    onClick={(e) => {
                      if (props.disabled || !refs.input || seg.paste === undefined) return
                      e.preventDefault()
                      e.stopPropagation()
                      paste.expand(seg.paste, refs.input, setText, () => {
                        enhanceToken++
                        preEnhance = null
                        history.reset()
                      })
                    }}
                  >
                    {seg.text}
                  </span>
                </Show>
              )}
            </For>
            <Show when={text().endsWith("\n")}>
              <br />
            </Show>
          </div>
          <Show when={keycaps()} keyed>
            {(caps) => <PromptHint before={caps.before} binding={caps.binding} after={caps.after} />}
          </Show>
          <textarea
            ref={(el) => (refs.input = el)}
            class="prompt-input"
            classList={{ "prompt-input--disabled": props.disabled, "prompt-input--keycaps": !!keycaps() }}
            placeholder={placeholder()}
            aria-label={language.t("prompt.placeholder.plain")}
            value={text()}
            onBeforeInput={(e) => paste.beforeInput(e, refs.input)}
            onInput={(e) => {
              // An edit invalidates an in-flight Enhance, so its late result cannot overwrite the new text.
              enhanceToken++
              preEnhance = null
              history.reset()
              setText(e.currentTarget.value)
              paste.afterInput()
              const cursor = e.currentTarget.selectionStart ?? e.currentTarget.value.length
              slash.input(e.currentTarget.value, cursor)
              mention.onInput(e.currentTarget.value, cursor)
            }}
            onPaste={(e) => {
              if (props.disabled || !refs.input) return
              images.handlePaste(e)
              paste.paste(e, refs.input, setText, () => {
                enhanceToken++
                preEnhance = null
              })
            }}
            onCopy={(e) => paste.clipboard(e, refs.input, setText)}
            onCut={(e) => paste.clipboard(e, refs.input, setText, true)}
            onKeyDown={(e) => {
              if (speechDown(e)) return
              if (undoEnhance(e)) return
              if (slash.keyDown(e, text(), replaceDraft)) return
              if (mention.onKeyDown(e, refs.input, setText)) {
                queueMicrotask(scrollMention)
                return
              }
              // A mention and a collapsed paste each delete as one unit.
              if (mention.handleBackspace(e, refs.input, setText)) return
              if (paste.backspace(e, refs.input, setText)) return
              paste.arrow(e, refs.input)
              if (mention.handleArrowKey(e, refs.input)) return
              if (historyKey(e)) return
              if (!isEnterKeyCommitNotIme(e) || e.shiftKey) return
              e.preventDefault()
              send(sendMode(e, props.running, runningDelivery()))
            }}
            onKeyUp={(e) => {
              speechUp(e)
            }}
            onSelect={() => {
              if (refs.input) mention.snapSelection(refs.input)
            }}
            onScroll={scroll}
            onFocus={() => {
              setFocused(true)
              props.onFocusChange?.(true)
            }}
            onBlur={() => {
              setFocused(false)
              props.onFocusChange?.(false)
            }}
            aria-disabled={props.disabled}
            readOnly={props.disabled}
            rows={1}
            dir="auto"
          />
        </div>
      </div>
      <div class="prompt-input-hint" ref={(el) => (hintRef = el)}>
        {props.selectors}
        <div class="prompt-input-hint-actions" data-measured={measured() ? "" : undefined}>
          <div class="prompt-action" data-folded={hidden().length === 0 ? "" : undefined}>
            <PromptOverflow items={hidden()} />
          </div>
          <Show when={indexing.buttonVisible()}>
            <div class="prompt-action" data-folded={folded("indexing") ? "" : undefined}>
              <Tooltip value={indexing.status().message || indexing.label()} placement="top" openDelay={0}>
                <IconButton
                  icon="database"
                  variant="ghost"
                  size="small"
                  onClick={openIndexingSettings}
                  aria-label={language.t("prompt.action.indexing")}
                  class={`prompt-indexing-button prompt-indexing-button--${indexing.tone()}`}
                />
              </Tooltip>
            </div>
          </Show>
          <Show when={props.sandbox?.visible() ? props.sandbox : undefined}>
            {(sandbox) => (
              <div class="prompt-action" data-folded={folded("sandbox") ? "" : undefined}>
                <SandboxButtonBase
                  enabled={sandbox().enabled()}
                  available={sandbox().ready() ? sandbox().available() : undefined}
                  reason={sandbox().reason()}
                  disabled={sandbox().disabled()}
                  tooltip={<SandboxTooltipContent enabled={sandbox().enabled()} network={sandbox().network()} />}
                  tooltipClass="prompt-sandbox-tooltip-content"
                  onToggle={sandbox().onToggle}
                />
              </div>
            )}
          </Show>
          <div class="prompt-action" data-folded={folded("enhance") ? "" : undefined}>
            <Tooltip value={language.t("prompt.action.enhance")} placement="top" openDelay={0}>
              <IconButton
                icon="wand-sparkles"
                variant="ghost"
                size="small"
                onClick={enhance}
                disabled={!canEnhance()}
                loading={enhancing()}
                aria-label={language.t("prompt.action.enhance")}
              />
            </Tooltip>
          </div>
          <Show when={props.autoApprove}>
            {(autoApprove) => (
              <div class="prompt-action" data-folded={folded("approve") ? "" : undefined}>
                <Tooltip value={approveTooltip()} placement="top" openDelay={0}>
                  <IconButton
                    icon="shield"
                    variant="ghost"
                    size="small"
                    onClick={autoApprove().onToggle}
                    aria-label={language.t(
                      autoApprove().enabled ? "prompt.action.autoApprove.disable" : "prompt.action.autoApprove.enable",
                    )}
                    aria-pressed={autoApprove().enabled}
                    class="prompt-status-button"
                    classList={{ "prompt-status-button--active": autoApprove().enabled }}
                  />
                </Tooltip>
              </div>
            )}
          </Show>
          <div class="prompt-input-hint-pinned" ref={(el) => (pinnedRef = el)}>
            <Show when={canUseSpeech()}>
              <SpeechToTextButton speech={speech} disabled={props.disabled} start={startSpeech} label={language.t} />
            </Show>
            <Show
              when={showStop()}
              fallback={
                <Tooltip value={sendHint()} placement="top" openDelay={0}>
                  <button
                    type="button"
                    data-component="icon-button"
                    data-size="small"
                    data-variant="ghost"
                    data-icon={sendIcon()}
                    class="prompt-send-button"
                    onClick={(event) => send(sendMode(event, props.running, runningDelivery()))}
                    disabled={!canSend()}
                    aria-label={sendLabel()}
                  >
                    <For each={SEND_ICONS}>
                      {(name) => (
                        <span
                          class="prompt-send-icon"
                          data-name={name}
                          data-active={sendIcon() === name ? "" : undefined}
                        >
                          <Icon name={name} size="small" />
                        </span>
                      )}
                    </For>
                  </button>
                </Tooltip>
              }
            >
              <Tooltip value={language.t("prompt.action.stop")} placement="top" openDelay={0}>
                <IconButton
                  icon="stop"
                  variant="ghost"
                  size="small"
                  onClick={props.onStop}
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
