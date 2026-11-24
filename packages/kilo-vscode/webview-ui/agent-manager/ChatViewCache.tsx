import {
  For,
  Show,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js"
import type { FileDiffInfo, ModelRef } from "@opencode/client"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import type { GitChangesTarget } from "../src/hooks/useGitChangesContext"
import type { WorktreeReference } from "../src/utils/prompt-mention-drop"
import type { AppendHandler, ReferenceHandler, ReviewAppendHandler } from "../src/v2/append-ready"
import type { ComposerHandle } from "../src/v2/composer"
import { V2Scope } from "../src/v2/client"
import type { V2 } from "../src/v2/scope"
import { SessionView } from "../src/v2/session-view"
import type { ManagerContext } from "../src/v2/shortcut-hint"
import { ViewActiveProvider, blurOnHide, freezeValue, skipInactiveFocus } from "../src/v2/view-active"
import { SpeechToTextStatusProvider } from "../src/components/speech-to-text/status"
import {
  chatSlotKey,
  emptyChatCache,
  promoteChatSlot,
  pruneChatSlots,
  rememberChatSlot,
  type ChatCacheSlot,
} from "./chat-view-cache"

interface SessionOrigin {
  project: string | undefined
  worktree: string | null
}

interface MountedSlot extends ChatCacheSlot {
  readonly store: V2
  readonly origin: SessionOrigin
  readonly keySignal: Accessor<string>
  readonly setKeySignal: (next: string) => void
  readonly session: Accessor<string | undefined>
  readonly setSession: (id: string | undefined) => void
  readonly draftKey: Accessor<string | undefined>
  readonly setDraftKey: (key: string | undefined) => void
  size?: { width: number; height: number }
}

interface SlotHandles {
  append?: AppendHandler
  reviewAppend?: ReviewAppendHandler
  composer?: ComposerHandle
  reference?: ReferenceHandler
}

export interface ChatViewCacheProps {
  store: Accessor<V2 | undefined>
  retained: Accessor<readonly string[]>
  alive: (directory: string, store: V2) => boolean
  session: Accessor<string | undefined>
  draftKey: Accessor<string | undefined>
  hidden: Accessor<boolean>
  origin: (directory: string) => SessionOrigin
  fallback: () => JSX.Element
  readOnly: Accessor<boolean>
  onSession: (id: string | undefined, origin: SessionOrigin, draftKey?: string) => void
  actions: ToolActions
  onShowHistory: () => void
  row: (hasMessages: boolean, todos: JSX.Element, agents: JSX.Element) => JSX.Element
  rowWhenEmpty: Accessor<boolean>
  onNewSession: () => void
  worktree: Accessor<boolean>
  onUpdateBase: () => void
  manager: () => ManagerContext | undefined
  focusOnDraftChange: () => boolean
  onFocusChange: (focused: boolean) => void
  empty: () => JSX.Element
  onAppendReady: (append: AppendHandler | undefined) => void
  onReviewAppendReady: (append: ReviewAppendHandler | undefined) => void
  onComposerReady: (composer: ComposerHandle | undefined) => void
  onReferenceReady: (add: ReferenceHandler | undefined) => void
  onPreviewEdit: (files: FileDiffInfo[], sessionID: string) => void
  onViewTurnChanges: (sessionID: string, turnID: string) => void
  onForkMessage: (sessionID: string, messageID: string) => void
  onMissing: (sessionID: string) => void
  onRegisterEvict?: (evict: (sessionOrDraftId: string) => void) => void
  worktrees: Accessor<WorktreeReference[]>
  git: () => boolean
  gitTarget: () => GitChangesTarget | undefined
  terminalContext: () => string | undefined
  resolveEmbeddedTerminal: (context?: string) => Promise<string | undefined>
  onPrompted: (sessionId: string, text: string, model: ModelRef | undefined) => void
}

export const ChatViewCache: Component<ChatViewCacheProps> = (props) => {
  const [cache, setCache] = createSignal(emptyChatCache<MountedSlot>())
  const handles = new Map<number, SlotHandles>()
  const [handleRev, setHandleRev] = createSignal(0)
  let nextId = 1
  let hostSize = { width: 0, height: 0 }

  // Compute the active key synchronously in the memo phase so outgoing slots freeze
  // BEFORE any freezeValue memos or <Show when={!props.readOnly}> re-evaluate.
  const currentKey = createMemo(() => {
    const store = props.store()
    if (!store || props.hidden()) return undefined
    return chatSlotKey(store.directory, props.session() ?? props.draftKey())
  })

  const activeEntry = createMemo(() => {
    const key = currentKey()
    if (!key) return undefined
    return cache().entries.find((item) => item.keySignal() === key)
  })

  // Track host size asynchronously via one shared ResizeObserver and attach the
  // observed dimensions to the active slot so every slot pins its own exact width
  // when hidden, even across rapid full-width <-> split-width switches.
  let hostEl: HTMLDivElement | undefined
  onMount(() => {
    const el = hostEl
    if (!el) return
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      hostSize = { width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) }
      const current = untrack(activeEntry)
      if (current && !current.size) current.size = { ...hostSize }
    }
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width <= 0 || box.height <= 0) return
      hostSize = { width: Math.round(box.width), height: Math.round(box.height) }
      const current = untrack(activeEntry)
      if (current) current.size = { ...hostSize }
    })
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  // Synchronously ensure the active slot exists during computed phase (before render effects).
  createComputed(() => {
    const store = props.store()
    const session = props.session()
    const draft = props.draftKey()
    const key = currentKey()
    if (!store || !key) return

    const prev = untrack(cache)
    const result = rememberChatSlot(prev, key, () => {
      const [keySignal, setKeySignal] = createSignal(key)
      const [slotSession, setSlotSession] = createSignal(session)
      const [slotDraft, setSlotDraft] = createSignal(session ?? draft)
      return {
        id: nextId++,
        key,
        directory: store.directory,
        store,
        origin: untrack(() => props.origin(store.directory)),
        keySignal,
        setKeySignal,
        session: slotSession,
        setSession: setSlotSession,
        draftKey: slotDraft,
        setDraftKey: setSlotDraft,
        size: hostSize.width > 0 && hostSize.height > 0 ? { ...hostSize } : undefined,
      }
    })
    if (result.state !== prev) setCache(result.state)
    for (const evicted of result.evicted) handles.delete(evicted.id)
  })

  // Evict slots whose underlying directory V2Scope was disposed (e.g., project switch or deleted worktree).
  createEffect(() => {
    props.retained()
    const current = cache()
    const next = pruneChatSlots(current, (slot) => props.alive(slot.directory, slot.store))
    if (next === current) return
    const kept = new Set(next.entries.map((item) => item.id))
    for (const id of handles.keys()) if (!kept.has(id)) handles.delete(id)
    setCache(next)
  })

  // Allow tab close / session eviction to drop closed slots immediately.
  props.onRegisterEvict?.((sessionOrDraftId) => {
    setCache((prev) => {
      const next = pruneChatSlots(
        prev,
        (slot) => slot.session() !== sessionOrDraftId && slot.draftKey() !== sessionOrDraftId,
      )
      if (next === prev) return prev
      const kept = new Set(next.entries.map((item) => item.id))
      for (const id of handles.keys()) if (!kept.has(id)) handles.delete(id)
      return next
    })
  })

  // Expose ONLY the active slot's composer handles to AgentManagerApp.
  createEffect(() => {
    handleRev()
    const active = activeEntry()
    const record = active ? handles.get(active.id) : undefined
    props.onAppendReady(record?.append)
    props.onReviewAppendReady(record?.reviewAppend)
    props.onComposerReady(record?.composer)
    props.onReferenceReady(record?.reference)
  })

  onCleanup(() => {
    props.onAppendReady(undefined)
    props.onReviewAppendReady(undefined)
    props.onComposerReady(undefined)
    props.onReferenceReady(undefined)
  })

  const updateHandle = <K extends keyof SlotHandles>(id: number, field: K, value: SlotHandles[K]) => {
    // Unmounting an evicted slot fires onCleanup with undefined; do not re-insert dead IDs.
    if (value === undefined && !untrack(cache).entries.some((item) => item.id === id)) {
      handles.delete(id)
      return
    }
    const record = handles.get(id) ?? {}
    record[field] = value
    handles.set(id, record)
    if (untrack(activeEntry)?.id === id) setHandleRev((n) => n + 1)
  }

  const dropSlot = (id: number) => {
    handles.delete(id)
    setCache((prev) => pruneChatSlots(prev, (slot) => slot.id !== id))
  }

  const showFallback = () => !props.hidden() && !props.store()

  return (
    <div class="am-chat-host" classList={{ "am-chat-host-hidden": props.hidden() }} ref={hostEl}>
      <Show when={showFallback()}>
        <div class="am-chat-wrapper am-chat-fallback">
          <div class="am-intro-fallback">{props.fallback()}</div>
        </div>
      </Show>
      <For each={cache().entries}>
        {(entry) => {
          const active = createMemo(() => !props.hidden() && currentKey() === entry.keySignal())
          let slotEl: HTMLDivElement | undefined

          // Blur before render effects mutate DOM classes, and pin hidden slot box
          // dimensions using the slot's last observed host size (zero DOM reads on switch).
          blurOnHide(active, () => slotEl)
          createEffect(
            on(
              active,
              (isActive) => {
                if (!slotEl) return
                if (!isActive) {
                  const pinned = entry.size ?? (hostSize.width > 0 && hostSize.height > 0 ? hostSize : undefined)
                  if (pinned) {
                    slotEl.style.width = `${pinned.width}px`
                    slotEl.style.height = `${pinned.height}px`
                  }
                  return
                }
                slotEl.style.width = ""
                slotEl.style.height = ""
              },
              { defer: true },
            ),
          )

          const frozenReadOnly = freezeValue(active, props.readOnly)
          const frozenRowWhenEmpty = freezeValue(active, props.rowWhenEmpty)
          const frozenWorktree = freezeValue(active, props.worktree)
          const frozenGitTarget = freezeValue(active, props.gitTarget)
          const frozenTerminalContext = freezeValue(active, props.terminalContext)
          const frozenManager = freezeValue(active, props.manager)
          const frozenWorktrees = freezeValue(active, props.worktrees)
          const frozenGit = freezeValue(active, props.git)

          return (
            <div
              ref={slotEl}
              class="am-chat-wrapper am-chat-slot"
              classList={{
                "am-chat-slot-active": active(),
                "am-chat-wrapper-hidden": !active(),
              }}
              onFocusIn={(event) => {
                if (!active() && slotEl) skipInactiveFocus(event, slotEl)
              }}
            >
              <V2Scope value={entry.store}>
                <ViewActiveProvider active={active}>
                  <SpeechToTextStatusProvider>
                    <SessionView
                      session={entry.session()}
                      draftKey={entry.draftKey()}
                      readOnly={frozenReadOnly()}
                      displayManaged
                      onSession={(id, key) => {
                        if (id) {
                          const nextKey = chatSlotKey(entry.directory, id)
                          entry.setSession(id)
                          entry.setDraftKey(id)
                          entry.setKeySignal(nextKey)
                          setCache((prev) => {
                            const promoted = promoteChatSlot(prev, entry.id, nextKey)
                            for (const evicted of promoted.evicted) handles.delete(evicted.id)
                            return promoted.state
                          })
                          props.onSession(id, entry.origin, key)
                          return
                        }
                        // Background deletion or move must drop only this cached slot without
                        // clearing whichever unrelated active session the user is viewing.
                        const wasActive = untrack(active)
                        dropSlot(entry.id)
                        if (wasActive) props.onSession(undefined, entry.origin, key)
                      }}
                      actions={props.actions}
                      onShowHistory={props.onShowHistory}
                      row={props.row}
                      rowWhenEmpty={frozenRowWhenEmpty()}
                      onNewSession={props.onNewSession}
                      worktree={frozenWorktree()}
                      onUpdateBase={props.onUpdateBase}
                      manager={frozenManager}
                      focusOnDraftChange={props.focusOnDraftChange}
                      onFocusChange={(focused) => {
                        if (active()) props.onFocusChange(focused)
                      }}
                      empty={props.empty}
                      onAppendReady={(fn) => updateHandle(entry.id, "append", fn)}
                      onReviewAppendReady={(fn) => updateHandle(entry.id, "reviewAppend", fn)}
                      onComposerReady={(fn) => updateHandle(entry.id, "composer", fn)}
                      onReferenceReady={(fn) => updateHandle(entry.id, "reference", fn)}
                      onPreviewEdit={props.onPreviewEdit}
                      onViewTurnChanges={props.onViewTurnChanges}
                      onForkMessage={props.onForkMessage}
                      onMissing={(id) => {
                        const wasActive = untrack(active)
                        dropSlot(entry.id)
                        if (wasActive) props.onMissing(id)
                      }}
                      worktrees={frozenWorktrees}
                      git={frozenGit}
                      gitTarget={frozenGitTarget}
                      terminalContext={frozenTerminalContext}
                      resolveEmbeddedTerminal={props.resolveEmbeddedTerminal}
                      onPrompted={props.onPrompted}
                    />
                  </SpeechToTextStatusProvider>
                </ViewActiveProvider>
              </V2Scope>
            </div>
          )
        }}
      </For>
    </div>
  )
}
