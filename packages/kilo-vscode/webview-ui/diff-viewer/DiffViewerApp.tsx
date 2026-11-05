import { batch, createEffect, createMemo, createSignal, on, onCleanup, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { FullScreenDiffView } from "./FullScreenDiffView"
import { mergeWorktreeDiffs, resolveDiffFile } from "./diff-state"
import { createPRDiffs } from "./pr-diff"
import { useLanguage } from "../src/context/language"
import { getVSCodeAPI, useVSCode } from "../src/context/vscode"
import type { WebviewMessage } from "../src/types/messages"
import type { PRComment } from "../agent-manager/pr/pr-types"
import { reviewRequest } from "../agent-manager/pr/pr-review-request"
import { createDiffCommentForms } from "../agent-manager/pr/diff-comment-forms"
import {
  APPEND_REVIEW_COMMENTS,
  type AppendReviewCommentsDetail,
} from "./review-annotations"
import type { BranchInfo, DiffViewerNotice, WorktreeFileDiff } from "../src/types/messages/agent-manager"
import type { DiffSourceCapabilities, DiffSourceDescriptor } from "../../src/diff/sources/types"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"
import type { ReviewComment } from "./review-comments"
import { DiffPickerHeader } from "./DiffPickerHeader"
import { BaseBranchPicker } from "./BaseBranchPicker"

type DiffStyle = "unified" | "split"

/** Messages of the standalone Changes panel. The shared host protocol does not describe them. */
type DiffViewerMessage = { type: string } & Record<string, unknown>

const post = (message: DiffViewerMessage) => getVSCodeAPI().postMessage(message as unknown as WebviewMessage)

// Compare only the PR identity. Ref-only refreshes must not clear local comments.
function samePR(a: PRTarget | undefined, b: PRTarget | undefined) {
  return a?.projectId === b?.projectId && a?.prNumber === b?.prNumber && a?.prUrl === b?.prUrl
}

export const DiffViewerApp: Component = () => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const [diffs, setDiffs] = createSignal<WorktreeFileDiff[]>([])
  const [loading, setLoading] = createSignal(true)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [context, setContext] = createSignal("")
  const [remote, setRemote] = createSignal<PRComment[]>([])
  const [target, setTarget] = createSignal<PRTarget>()
  const [threads, setThreads] = createSignal<string[]>([])
  const [focus, setFocus] = createSignal<{ id: string; file: string }>()
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>("unified")
  // Remembered style pushed by the host; used when the source or PR identity changes so a persisted choice survives.
  const [savedDiffStyle, setSavedDiffStyle] = createSignal<DiffStyle>()
  const [markdown, setMarkdown] = createSignal(false)
  const [reverting, setReverting] = createSignal<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = createSignal<Set<string>>(new Set())
  const [availableSources, setAvailableSources] = createSignal<DiffSourceDescriptor[]>([])
  const [currentSourceId, setCurrentSourceId] = createSignal<string | undefined>(undefined)
  const [initialFile, setInitialFile] = createSignal<string | undefined>(undefined)
  const [capabilities, setCapabilities] = createSignal<DiffSourceCapabilities | undefined>(undefined)
  const [notice, setNotice] = createSignal<DiffViewerNotice | undefined>(undefined)
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [defaultBranch, setDefaultBranch] = createSignal<string>("")
  const [autoBase, setAutoBase] = createSignal<string | undefined>(undefined)
  const [currentBase, setCurrentBase] = createSignal<string | undefined>(undefined)
  const [isAuto, setIsAuto] = createSignal(true)
  const [currentBranch, setCurrentBranch] = createSignal<string | undefined>(undefined)
  const [branchesLoading, setBranchesLoading] = createSignal(false)
  const [prMode, setPRMode] = createSignal(false)
  const [prSnapshot, setPRSnapshot] = createSignal<PRDiffSnapshot>()
  const [prLoading, setPRLoading] = createSignal(false)
  const [prError, setPRError] = createSignal<string>()
  let prKey = ""
  let prRequestId = ""

  const prDiffs = createMemo(() => {
    const snapshot = prSnapshot()
    return snapshot ? createPRDiffs(snapshot) : []
  })
  const activeDiffs = () => (prMode() ? prDiffs() : diffs())
  const activeLoading = () => (prMode() ? prLoading() : loading())
  const noLoadingFiles = new Set<string>()
  const activeLoadingFiles = () => (prMode() ? noLoadingFiles : loadingFiles())
  const forms = createDiffCommentForms({
    target,
    snapshot: prSnapshot,
    diffs: activeDiffs,
    worktree: () => "diff",
    canPublish: () => prMode(),
  })

  const isWorkspaceSource = () => {
    const id = currentSourceId()
    if (!id) return false
    const desc = availableSources().find((d) => d.id === id)
    return desc?.type === "workspace"
  }

  const markReverting = (file: string, active: boolean) => {
    setReverting((prev) => {
      const next = new Set(prev)
      if (active) next.add(file)
      else next.delete(file)
      return next
    })
  }

  const markLoadingFile = (file: string, active: boolean) => {
    setLoadingFiles((prev) => {
      if (active && prev.has(file)) return prev
      if (!active && !prev.has(file)) return prev
      const next = new Set(prev)
      if (active) next.add(file)
      else next.delete(file)
      return next
    })
  }

  const requestDiffFile = (file: string) => {
    if (loadingFiles().has(file)) return
    markLoadingFile(file, true)
    post({ type: "diffViewer.requestFile", file })
  }

  const refreshStaleDiffs = (files: Set<string>) => {
    for (const file of files) {
      if (loadingFiles().has(file)) continue
      markLoadingFile(file, true)
      post({ type: "diffViewer.requestFile", file })
    }
  }

  // Clear all PR-specific state so a new source, target, or request starts clean.
  const resetPR = () => {
    prKey = ""
    prRequestId = ""
    setPRSnapshot(undefined)
    setPRLoading(false)
    setPRError(undefined)
    setPRMode(false)
  }

  const requestPRFiles = (next: PRTarget | undefined) => {
    if (!next) {
      resetPR()
      return
    }
    const key = JSON.stringify(next)
    if (prKey === key && (prLoading() || prSnapshot())) return
    prKey = key
    const requestId = crypto.randomUUID()
    prRequestId = requestId
    setPRSnapshot(undefined)
    setPRLoading(true)
    setPRError(undefined)
    reviewRequest({ ...next, type: "agentManager.loadPRFiles", requestId }, post, (result) => {
      if (prKey !== key || prRequestId !== requestId) return
      if (result.type !== "agentManager.loadPRFilesResult") return
      if (!result.success || !result.snapshot) {
        setPRLoading(false)
        setPRError(result.error || t("diffViewer.comment.loadFailed"))
        return
      }
      setPRSnapshot(result.snapshot)
      setPRLoading(false)
    })
  }

  const togglePRMode = () => {
    if (!prSnapshot()) {
      requestPRFiles(target())
      return
    }
    setComments([])
    setPRMode((value) => !value)
  }

  const resetContext = (key: string) => {
    if (context() === key) return
    batch(() => {
      setContext(key)
      setDiffs([])
      setComments([])
      setRemote([])
      setTarget(undefined)
      setThreads([])
      setFocus(undefined)
      setInitialFile(undefined)
      setLoadingFiles(new Set<string>())
      setReverting(new Set<string>())
      setBranches([])
      setDefaultBranch("")
      setAutoBase(undefined)
      setCurrentBase(undefined)
      setCurrentBranch(undefined)
      setIsAuto(true)
      resetPR()
    })
  }

  const applyPRComments = (msg: DiffViewerMessage) => {
    // Only clear local comments when the PR identity changes. Ref-only refreshes (a push or rebase) must keep
    // unsent comments.
    const changed = !samePR(target(), msg.target as PRTarget | undefined)
    batch(() => {
      setRemote((msg.comments as PRComment[]) ?? [])
      setTarget(msg.target as PRTarget | undefined)
      setThreads((msg.threads as string[]) ?? [])
      if (changed) {
        setComments([])
        setDiffStyle(savedDiffStyle() ?? "unified")
        setPRMode(false)
      }
    })
    requestPRFiles(msg.target as PRTarget | undefined)
  }

  const handlers: Record<string, (msg: DiffViewerMessage) => void> = {
    "diffViewer.context": (msg) => resetContext(String(msg.key ?? "")),
    "diffViewer.prComments": applyPRComments,
    "diffViewer.focusComment": (msg) => setFocus({ id: String(msg.id), file: String(msg.file) }),
    "diffViewer.diffs": (msg) => {
      // Preserve cached before/after across polls so summarized updates do not clobber loaded detail.
      const merged = mergeWorktreeDiffs(diffs(), (msg.diffs as WorktreeFileDiff[]) ?? [])
      setDiffs(merged.diffs)
      if (merged.stale.size > 0) refreshStaleDiffs(merged.stale)
    },
    "diffViewer.diffFile": (msg) => {
      setDiffs((prev) => resolveDiffFile(prev, String(msg.file), (msg.diff as WorktreeFileDiff | null) ?? null))
      markLoadingFile(String(msg.file), false)
    },
    "diffViewer.loading": (msg) => setLoading(msg.loading === true),
    "diffViewer.revertFileResult": (msg) => markReverting(String(msg.file), false),
    "diffViewer.markdownRender": (msg) => setMarkdown(msg.render === true),
    "diffViewer.initialDiffStyle": (msg) => {
      if (msg.style !== "unified" && msg.style !== "split") return
      setSavedDiffStyle(msg.style)
      setDiffStyle(msg.style)
    },
    "diffViewer.initialFile": (msg) => setInitialFile(typeof msg.file === "string" ? msg.file : undefined),
    "diffViewer.initialMarkdown": (msg) => setMarkdown(msg.render === true),
    setAvailableSources: (msg) => {
      batch(() => {
        setAvailableSources((msg.descriptors as DiffSourceDescriptor[]) ?? [])
        setCurrentSourceId(typeof msg.currentId === "string" ? msg.currentId : undefined)
        setLoadingFiles(new Set<string>())
      })
    },
    "diffViewer.capabilities": (msg) => setCapabilities(msg.capabilities as DiffSourceCapabilities | undefined),
    "diffViewer.notice": (msg) => setNotice(msg.notice as DiffViewerNotice | undefined),
    "diffViewer.branches": (msg) => {
      setBranches((msg.branches as BranchInfo[]) ?? [])
      setDefaultBranch(String(msg.defaultBranch ?? ""))
      setAutoBase(msg.autoBase as string | undefined)
      setCurrentBase(msg.currentBase as string | undefined)
      setIsAuto(msg.isAuto === true)
      setCurrentBranch(msg.currentBranch as string | undefined)
      setBranchesLoading(false)
    },
  }

  const unsubscribe = vscode.onMessage((raw) => {
    const msg = raw as unknown as DiffViewerMessage
    handlers[msg.type]?.(msg)
  })

  const selectSource = (id: string) => {
    if (id === currentSourceId()) return
    setFocus(undefined)
    setInitialFile(undefined)
    post({ type: "selectSource", id })
  }

  // Reset transient UI state when the active source changes.
  createEffect(
    on(currentSourceId, (id, prev) => {
      if (prev === undefined || id === prev) return
      setComments([])
      setDiffStyle(savedDiffStyle() ?? "unified")
      setReverting(new Set<string>())
      setNotice(undefined)
      setPRError(undefined)
      setPRMode(false)
    }),
  )

  // Fetch branches whenever the active source becomes the workspace one.
  createEffect(
    on([context, isWorkspaceSource], ([, visible]) => {
      if (!visible) return
      setBranchesLoading(true)
      post({ type: "diffViewer.requestBranches" })
    }),
  )

  const onBaseBranchSelect = (branch: string | undefined) => {
    setCurrentBase(branch ?? autoBase())
    setIsAuto(branch === undefined)
    post({ type: "diffViewer.setBaseBranch", branch })
  }

  const onReviewComments = (event: Event) => {
    const detail = (event as CustomEvent<AppendReviewCommentsDetail>).detail
    if (!detail || detail.handled || detail.comments.length === 0) return
    detail.handled = true
    post({ type: "diffViewer.sendComments", comments: detail.comments, autoSend: detail.autoSend })
  }

  window.addEventListener(APPEND_REVIEW_COMMENTS, onReviewComments)
  onCleanup(() => {
    unsubscribe()
    window.removeEventListener(APPEND_REVIEW_COMMENTS, onReviewComments)
  })

  post({ type: "webviewReady" })

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <Show when={availableSources().length > 0}>
        <DiffPickerHeader
          descriptors={availableSources()}
          currentId={currentSourceId()}
          onSelect={selectSource}
          accessory={
            <div class="diff-pr-controls">
              <Show when={isWorkspaceSource() && !prMode()}>
                <BaseBranchPicker
                  branches={branches()}
                  loading={branchesLoading()}
                  defaultBranch={defaultBranch()}
                  autoBase={autoBase()}
                  currentBase={currentBase()}
                  isAuto={isAuto()}
                  currentBranch={currentBranch()}
                  onSelect={onBaseBranchSelect}
                />
              </Show>
              <Show when={target()}>
                {(pr) => (
                  <Show when={isWorkspaceSource()}>
                    <span class="diff-pr-context" title={pr().prUrl}>
                      {t("diffViewer.comment.prContext", { number: pr().prNumber })}
                    </span>
                    <IconButton
                      icon="external-link"
                      size="small"
                      variant="ghost"
                      label={t("diffViewer.comment.openPR")}
                      onClick={() => post({ type: "openExternal", url: pr().prUrl })}
                    />
                    <Button
                      size="small"
                      variant={prMode() ? "primary" : "secondary"}
                      disabled={prLoading() && !prSnapshot()}
                      onClick={togglePRMode}
                    >
                      <Show when={prLoading()}>
                        <Spinner />
                      </Show>
                      {prMode() ? t("diffViewer.comment.localChanges") : t("diffViewer.comment.prChanges")}
                    </Button>
                  </Show>
                )}
              </Show>
            </div>
          }
        />
      </Show>
      <FullScreenDiffView
        diffs={activeDiffs()}
        loading={activeLoading()}
        loadingFiles={activeLoadingFiles()}
        notice={notice()}
        onRequestDiff={prMode() ? undefined : requestDiffFile}
        sessionKey={`${context()}\0${currentSourceId() ?? "local"}\0${prMode() ? "pr" : "local"}`}
        worktreeId="diff"
        projectId={isWorkspaceSource() ? target()?.projectId : undefined}
        prTarget={isWorkspaceSource() ? target() : undefined}
        prSnapshot={prSnapshot()}
        prLoading={isWorkspaceSource() ? prLoading() : false}
        prError={isWorkspaceSource() ? prError() : undefined}
        remoteComments={remote()}
        remoteTarget={(comment) => (threads().includes(comment.threadId) ? target() : undefined)}
        applySuggestions={false}
        focusedComment={focus()}
        comments={comments()}
        onCommentsChange={setComments}
        onSendAll={() => {}}
        commentForm={forms.mount}
        commentsGithub={forms.github}
        diffStyle={diffStyle()}
        onDiffStyleChange={(style) => {
          setDiffStyle(style)
          setSavedDiffStyle(style)
          post({ type: "diffViewer.setDiffStyle", style })
        }}
        markdownRender={markdown()}
        onMarkdownRenderChange={(render) => {
          setMarkdown(render)
          post({ type: "diffViewer.setMarkdownRender", render })
        }}
        onOpenFile={(relativePath, line) => {
          post({ type: "openFile", filePath: relativePath, line })
        }}
        initialFile={initialFile()}
        onRevertFile={(file) => {
          markReverting(file, true)
          post({ type: "diffViewer.revertFile", file })
        }}
        revertingFiles={reverting()}
        canRevert={!prMode() && (capabilities()?.revert ?? true)}
        canComment={capabilities()?.comments ?? true}
        onClose={() => {
          post({ type: "diffViewer.close" })
        }}
      />
    </div>
  )
}
