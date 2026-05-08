import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import type { Component } from "solid-js"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { Icon } from "@kilocode/kilo-ui/icon"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { FullScreenDiffView } from "../agent-manager/FullScreenDiffView"
import { mergeWorktreeDiffs } from "../agent-manager/diff-state"
import { LanguageProvider, useLanguage } from "../src/context/language"
import { ServerProvider, useServer } from "../src/context/server"
import { getVSCodeAPI, VSCodeProvider, useVSCode } from "../src/context/vscode"
import type { BranchInfo, ReviewComment, WebviewMessage, WorktreeFileDiff } from "../src/types/messages"
import type { DiffSourceCapabilities, DiffSourceDescriptor } from "../../src/diff/sources/types"
import type { DiffViewerNotice } from "../src/types/messages/extension-messages"
import { DiffPickerHeader } from "./DiffPickerHeader"
import { BaseBranchPicker } from "./BaseBranchPicker"

const NOTICE_KEYS: Record<DiffViewerNotice, string> = {
  "snapshots-disabled": "diffViewer.notice.snapshotsDisabled",
}

type DiffStyle = "unified" | "split"

const post = (message: WebviewMessage) => getVSCodeAPI().postMessage(message)

const DiffViewerContent: Component = () => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const [diffs, setDiffs] = createSignal<WorktreeFileDiff[]>([])
  const [loading, setLoading] = createSignal(true)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>("unified")
  const [markdown, setMarkdown] = createSignal(false)
  const [reverting, setReverting] = createSignal<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = createSignal<Set<string>>(new Set())
  const [availableSources, setAvailableSources] = createSignal<DiffSourceDescriptor[]>([])
  const [currentSourceId, setCurrentSourceId] = createSignal<string | undefined>(undefined)
  const [capabilities, setCapabilities] = createSignal<DiffSourceCapabilities | undefined>(undefined)
  const [notice, setNotice] = createSignal<DiffViewerNotice | undefined>(undefined)
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [defaultBranch, setDefaultBranch] = createSignal<string>("")
  const [autoBase, setAutoBase] = createSignal<string | undefined>(undefined)
  const [currentBase, setCurrentBase] = createSignal<string | undefined>(undefined)
  const [isAuto, setIsAuto] = createSignal(true)
  const [currentBranch, setCurrentBranch] = createSignal<string | undefined>(undefined)
  const [branchesLoading, setBranchesLoading] = createSignal(false)

  const isWorkspaceSource = () => {
    const id = currentSourceId()
    if (!id) return false
    const desc = availableSources().find((d) => d.id === id)
    return desc?.type === "workspace"
  }

  const noticeText = () => {
    const n = notice()
    if (!n) return ""
    return t(NOTICE_KEYS[n])
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

  const unsubscribe = vscode.onMessage((msg) => {
    if (msg.type === "diffViewer.diffs") {
      // Preserve cached `before`/`after` across polls so summarized polling
      // updates don't clobber loaded detail. Mirrors the agent manager's
      // worktree diff merge — see worktree-diff-controller.ts.
      const merged = mergeWorktreeDiffs(diffs(), msg.diffs)
      setDiffs(merged.diffs)
      if (merged.stale.size > 0) refreshStaleDiffs(merged.stale)
      return
    }

    if (msg.type === "diffViewer.diffFile") {
      markLoadingFile(msg.file, false)
      const fresh = msg.diff
      if (!fresh) return
      setDiffs((prev) => prev.map((entry) => (entry.file === fresh.file ? fresh : entry)))
      return
    }

    if (msg.type === "diffViewer.loading") {
      setLoading(msg.loading)
      return
    }

    if (msg.type === "diffViewer.revertFileResult") {
      markReverting(msg.file, false)
      return
    }

    if (msg.type === "diffViewer.markdownRender") {
      setMarkdown(msg.render)
      return
    }
    if (msg.type === "setAvailableSources") {
      setAvailableSources(msg.descriptors)
      setCurrentSourceId(msg.currentId)
      return
    }

    if (msg.type === "diffViewer.capabilities") {
      setCapabilities(msg.capabilities)
      return
    }

    if (msg.type === "diffViewer.notice") {
      setNotice(msg.notice)
      return
    }

    if (msg.type === "diffViewer.branches") {
      setBranches(msg.branches)
      setDefaultBranch(msg.defaultBranch)
      setAutoBase(msg.autoBase)
      setCurrentBase(msg.currentBase)
      setIsAuto(msg.isAuto)
      setCurrentBranch(msg.currentBranch)
      setBranchesLoading(false)
      return
    }
  })

  const selectSource = (id: string) => {
    if (id === currentSourceId()) return
    post({ type: "selectSource", id })
  }

  // Reset transient UI state when the active source changes. Comments are
  // discarded without confirmation; diff style goes back to
  // unified; in-flight revert indicators are cleared. The diffs list itself
  // is reset by the extension sending `diffs: []` before the new fetch.
  createEffect(
    on(currentSourceId, (id, prev) => {
      if (prev === undefined || id === prev) return
      setComments([])
      setDiffStyle("unified")
      setReverting(new Set<string>())
      setLoadingFiles(new Set<string>())
      setNotice(undefined)
    }),
  )

  // Fetch branches whenever the active source becomes the workspace one. The
  // extension owns the override state so we ask on every transition rather
  // than caching here.
  createEffect(() => {
    if (!isWorkspaceSource()) return
    setBranchesLoading(true)
    post({ type: "diffViewer.requestBranches" })
  })

  const onBaseBranchSelect = (branch: string | undefined) => {
    // Optimistically reflect the new selection so the trigger label updates
    // immediately; the extension echoes back authoritative state next.
    setCurrentBase(branch ?? autoBase())
    setIsAuto(branch === undefined)
    post({ type: "diffViewer.setBaseBranch", branch })
  }

  const handler = (event: MessageEvent) => {
    const msg = event.data
    if (msg?.type !== "appendReviewComments" || !Array.isArray(msg.comments)) return
    post({ type: "diffViewer.sendComments", comments: msg.comments, autoSend: !!msg.autoSend })
  }

  window.addEventListener("message", handler)
  onCleanup(() => {
    unsubscribe()
    window.removeEventListener("message", handler)
  })

  return (
    <>
      <Show when={availableSources().length > 0}>
        <DiffPickerHeader
          descriptors={availableSources()}
          currentId={currentSourceId()}
          onSelect={selectSource}
          accessory={
            <Show when={isWorkspaceSource()}>
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
          }
        />
      </Show>
      <Show when={noticeText()}>
        <div class="diff-viewer-notice" role="status">
          <span class="diff-viewer-notice-icon">
            <Icon name="warning" size="small" />
          </span>
          <span class="diff-viewer-notice-text">{noticeText()}</span>
        </div>
      </Show>
      <FullScreenDiffView
        diffs={diffs()}
        loading={loading()}
        loadingFiles={loadingFiles()}
        onRequestDiff={requestDiffFile}
        sessionKey={currentSourceId() ?? "local"}
        comments={comments()}
        onCommentsChange={setComments}
        onSendAll={() => {}}
        diffStyle={diffStyle()}
        onDiffStyleChange={(style) => {
          setDiffStyle(style)
          post({ type: "diffViewer.setDiffStyle", style })
        }}
        markdownRender={markdown()}
        onMarkdownRenderChange={(render) => {
          setMarkdown(render)
          post({ type: "diffViewer.setMarkdownRender", render })
        }}
        onOpenFile={(relativePath) => {
          post({ type: "openFile", filePath: relativePath })
        }}
        onRevertFile={(file) => {
          markReverting(file, true)
          post({ type: "diffViewer.revertFile", file })
        }}
        revertingFiles={reverting()}
        canRevert={capabilities()?.revert ?? true}
        canComment={capabilities()?.comments ?? true}
        onClose={() => {
          post({ type: "diffViewer.close" })
        }}
      />
    </>
  )
}

const DiffViewerShell: Component = () => {
  const server = useServer()

  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      <DiffComponentProvider component={Diff}>
        <CodeComponentProvider component={Code}>
          <FileComponentProvider component={File}>
            <MarkedProvider>
              <DiffViewerContent />
            </MarkedProvider>
          </FileComponentProvider>
        </CodeComponentProvider>
      </DiffComponentProvider>
    </LanguageProvider>
  )
}

export const DiffViewerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <DiffViewerShell />
          </ServerProvider>
        </VSCodeProvider>
      </DialogProvider>
      <Toast.Region />
    </ThemeProvider>
  )
}
