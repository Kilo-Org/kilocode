// New Worktree dialog — prompt, versions, model, mode, import tab

import { Component, For, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import type { AgentManagerBranchesMessage, AgentManagerImportResultMessage, BranchInfo } from "../src/types/messages"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../src/context/vscode"
import { useServer } from "../src/context/server"
import { useSession } from "../src/context/session"
import { ModelSelectorBase } from "../src/components/shared/ModelSelector"
import { ModeSwitcherBase } from "../src/components/shared/ModeSwitcher"
import {
  MultiModelSelector,
  type ModelAllocations,
  MAX_MULTI_VERSIONS,
  totalAllocations,
  allocationsToArray,
} from "./MultiModelSelector"
import { useLanguage } from "../src/context/language"
import { useImageAttachments, type ImageAttachment } from "../src/hooks/useImageAttachments"
import { convertToMentionPath } from "../src/utils/path-mentions"
import { BranchSelect } from "./BranchSelect"

type VersionCount = 1 | 2 | 3 | 4
const VERSION_OPTIONS: VersionCount[] = [1, 2, 3, 4]

type DialogTab = "new" | "import"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function sanitizeSegment(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._+@-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/@\{/g, "@")
    .replace(/-+/g, "-")
    .replace(/^[-.]|[-.]+$/g, "")
    .replace(/\.lock$/g, "")
    .slice(0, maxLength)
}

function sanitizeBranchName(name: string): string {
  return name
    .split("/")
    .map((s) => sanitizeSegment(s))
    .filter(Boolean)
    .join("/")
}

export const NewWorktreeDialog: Component<{ onClose: () => void; defaultBaseBranch?: string }> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()

  const [tab, setTab] = createSignal<DialogTab>("new")

  // --- Shared branch data (used by both New tab's base branch selector and Import tab) ---
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [branchesLoading, setBranchesLoading] = createSignal(false)
  const [defaultBranch, setDefaultBranch] = createSignal(props.defaultBaseBranch ?? "main")
  const [branchSearch, setBranchSearch] = createSignal("")

  // --- New tab state ---
  const [name, setName] = createSignal("")
  const cached = vscode.getState<Record<string, unknown>>()
  const [prompt, setPrompt] = createSignal((cached?.advancedDialogPrompt as string) ?? "")
  const [versions, setVersions] = createSignal<VersionCount>(1)
  const [model, setModel] = createSignal<{ providerID: string; modelID: string } | null>(null)
  const [compareMode, setCompareMode] = createSignal(false)
  const [modelAllocations, setModelAllocations] = createSignal<ModelAllocations>(new Map())
  const [agent, setAgent] = createSignal(session.selectedAgent())
  const [starting, setStarting] = createSignal(false)
  const [showAdvanced, setShowAdvanced] = createSignal(false)
  const [branchName, setBranchName] = createSignal("")
  const [baseBranch, setBaseBranch] = createSignal<string | null>(null)
  const [baseBranchOpen, setBaseBranchOpen] = createSignal(false)
  const [compareOpen, setCompareOpen] = createSignal(false)
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)

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
    setPrompt(result)
    persistPrompt(result)
    const pos = cursor + inserted.length + 1
    ref.setSelectionRange(pos, pos)
    ref.focus()
    adjustHeight()
  })

  // Restore cached images from webview state
  const cachedImages = cached?.advancedDialogImages as ImageAttachment[] | undefined
  if (cachedImages?.length) imageAttach.replace(cachedImages)

  const persistPrompt = (value: string) => {
    const state = vscode.getState<Record<string, unknown>>() ?? {}
    vscode.setState({ ...state, advancedDialogPrompt: value || undefined })
  }

  const persistImages = (imgs: ImageAttachment[]) => {
    const state = vscode.getState<Record<string, unknown>>() ?? {}
    vscode.setState({ ...state, advancedDialogImages: imgs.length > 0 ? imgs : undefined })
  }

  // Auto-persist images to webview state on any change
  createEffect(() => persistImages(imageAttach.images()))

  let textareaRef: HTMLTextAreaElement | undefined

  onMount(() => {
    setBranchesLoading(true)
    vscode.postMessage({ type: "agentManager.requestBranches" })
    // Resize textarea if restoring a cached prompt
    if (prompt()) adjustHeight()
  })

  const effectiveBaseBranch = () => baseBranch() ?? defaultBranch()

  const filteredBranches = createMemo(() => {
    const search = branchSearch().toLowerCase()
    if (!search) return branches()
    return branches().filter((b) => b.name.toLowerCase().includes(search))
  })

  const canSubmit = () => {
    if (starting()) return false
    if (compareMode() && totalAllocations(modelAllocations()) === 0) return false
    return true
  }

  const handleSubmit = () => {
    if (!canSubmit()) return
    setStarting(true)

    const text = prompt().trim() || undefined
    const defaultAgent = session.agents()[0]?.name
    const selectedAgent = agent() !== defaultAgent ? agent() : undefined
    const advanced = showAdvanced()
    const customBranch = advanced ? branchName().trim() || undefined : undefined
    const imgs = imageAttach.images()
    const imgFiles = imgs.length > 0 ? imgs.map((img) => ({ mime: img.mime, url: img.dataUrl })) : undefined

    const isCompare = compareMode()
    const allocations = isCompare ? allocationsToArray(modelAllocations()) : undefined
    const count = isCompare ? totalAllocations(modelAllocations()) : versions()
    const sel = isCompare ? null : model()

    vscode.postMessage({
      type: "agentManager.createMultiVersion",
      text,
      name: name().trim() || undefined,
      versions: count,
      providerID: sel?.providerID,
      modelID: sel?.modelID,
      agent: selectedAgent,
      baseBranch: advanced ? (baseBranch() ?? undefined) : undefined,
      branchName: customBranch,
      modelAllocations: allocations,
      files: imgFiles,
    })

    persistPrompt("")
    persistImages([])
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  // --- Import tab state ---
  const [prUrl, setPrUrl] = createSignal("")
  const [prPending, setPrPending] = createSignal(false)
  const [branchOpen, setBranchOpen] = createSignal(false)
  const [importPending, setImportPending] = createSignal(false)

  const isPending = () => prPending() || importPending()

  // Listen for branch data + import results
  const importUnsub = vscode.onMessage((msg) => {
    if (msg.type === "agentManager.branches") {
      const ev = msg as AgentManagerBranchesMessage
      setBranches(ev.branches)
      if (!props.defaultBaseBranch) setDefaultBranch(ev.defaultBranch)
      setBranchesLoading(false)
    }
    if (msg.type === "agentManager.importResult") {
      const ev = msg as AgentManagerImportResultMessage
      setPrPending(false)
      setImportPending(false)
      if (ev.success) {
        props.onClose()
      } else {
        const description = ev.errorCode ? t(`agentManager.setup.error.${ev.errorCode}`) : ev.message
        showToast({ variant: "error", title: t("agentManager.import.failed"), description })
      }
    }
  })

  onCleanup(() => importUnsub())

  const handlePRSubmit = () => {
    const url = prUrl().trim()
    if (!url || isPending()) return
    setPrPending(true)
    vscode.postMessage({ type: "agentManager.importFromPR", url })
  }

  const handleBranchSelect = (name: string) => {
    if (isPending()) return
    setImportPending(true)
    setBranchOpen(false)
    setBranchSearch("")
    vscode.postMessage({ type: "agentManager.importFromBranch", branch: name })
  }

  return (
    <Dialog title={t("agentManager.dialog.openWorktree")} fit>
      {/* Tab switcher */}
      <div class="am-tab-switcher">
        <button
          class="am-tab-switcher-pill"
          classList={{ "am-tab-switcher-pill-active": tab() === "new" }}
          onClick={() => setTab("new")}
          type="button"
        >
          {t("agentManager.dialog.tab.new")}
        </button>
        <button
          class="am-tab-switcher-pill"
          classList={{ "am-tab-switcher-pill-active": tab() === "import" }}
          onClick={() => setTab("import")}
          type="button"
        >
          {t("agentManager.dialog.tab.import")}
        </button>
      </div>

      {/* New tab */}
      <Show when={tab() === "new"}>
        <div class="am-nv-dialog" onKeyDown={handleKeyDown}>
          <div class="am-nv-dialog-content">
            <input
              class="am-nv-name-input"
              placeholder={t("agentManager.dialog.namePlaceholder")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            {/* Prompt input — reuses the sidebar chat-input base classes for consistent styling */}
            <div
              class="prompt-input-container am-prompt-input-container"
              classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
              onDragOver={imageAttach.handleDragOver}
              onDragLeave={imageAttach.handleDragLeave}
              onDrop={imageAttach.handleDrop}
            >
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
                          aria-label={t("agentManager.dialog.removeImage")}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="prompt-input-wrapper am-prompt-input-wrapper">
                <div class="prompt-input-ghost-wrapper am-prompt-input-ghost-wrapper">
                  <textarea
                    ref={textareaRef}
                    autofocus
                    class="prompt-input am-prompt-input"
                    placeholder={t(
                      isMac
                        ? "agentManager.dialog.promptPlaceholder.mac"
                        : "agentManager.dialog.promptPlaceholder.other",
                    )}
                    value={prompt()}
                    onInput={(e) => {
                      const val = e.currentTarget.value
                      setPrompt(val)
                      persistPrompt(val)
                      adjustHeight()
                    }}
                    onPaste={(e) => imageAttach.handlePaste(e)}
                    rows={3}
                  />
                </div>
              </div>
              <div class="prompt-input-hint">
                <div class="prompt-input-hint-selectors">
                  <Show when={!compareMode()}>
                    <ModelSelectorBase
                      value={model()}
                      onSelect={(pid, mid) => setModel(pid && mid ? { providerID: pid, modelID: mid } : null)}
                      placement="top-start"
                      allowClear
                      clearLabel="Default"
                    />
                  </Show>
                  <Show when={session.agents().length > 1}>
                    <ModeSwitcherBase agents={session.agents()} value={agent()} onSelect={setAgent} />
                  </Show>
                </div>
                <div class="prompt-input-hint-actions" />
              </div>
            </div>

            {/* Advanced options toggle */}
            <button class="am-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced())} type="button">
              <Icon name={showAdvanced() ? "chevron-down" : "chevron-right"} size="small" />
              <span>{t("agentManager.dialog.advancedOptions")}</span>
            </button>

            <Show when={showAdvanced()}>
              <div class="am-advanced-section">
                <div class="am-advanced-field">
                  <span class="am-nv-config-label">{t("agentManager.dialog.branchName")}</span>
                  <input
                    class="am-advanced-input"
                    type="text"
                    placeholder={t("agentManager.dialog.branchNamePlaceholder")}
                    value={branchName()}
                    onInput={(e) => setBranchName(sanitizeBranchName(e.currentTarget.value))}
                  />
                </div>
                <div class="am-advanced-field">
                  <span class="am-nv-config-label">{t("agentManager.dialog.baseBranch")}</span>
                  <div class="am-selector-wrapper">
                    <Popover
                      open={baseBranchOpen()}
                      onOpenChange={(open) => {
                        setBaseBranchOpen(open)
                        if (!open) {
                          setBranchSearch("")
                          setHighlightedIndex(0)
                        }
                      }}
                      placement="top-start"
                      flip={false}
                      sameWidth
                      portal={false}
                      class="am-dropdown"
                      trigger={
                        <button class="am-selector-trigger" type="button">
                          <span class="am-selector-left">
                            <Icon name="branch" size="small" />
                            <span class="am-selector-value">{effectiveBaseBranch()}</span>
                            <Show when={!baseBranch()}>
                              <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.default")}</span>
                            </Show>
                          </span>
                          <span class="am-selector-right">
                            <Icon name="selector" size="small" />
                          </span>
                        </button>
                      }
                    >
                      <BranchSelect
                        branches={filteredBranches()}
                        loading={branchesLoading()}
                        search={branchSearch()}
                        onSearch={(v) => {
                          setBranchSearch(v)
                          setHighlightedIndex(0)
                        }}
                        onSelect={(b) => {
                          setBaseBranch(b.name)
                          setBaseBranchOpen(false)
                          setBranchSearch("")
                          setHighlightedIndex(0)
                        }}
                        onSearchKeyDown={(e) => {
                          const items = filteredBranches()
                          if (e.key === "ArrowDown") {
                            e.preventDefault()
                            e.stopPropagation()
                            const next = Math.min(highlightedIndex() + 1, items.length - 1)
                            setHighlightedIndex(next)
                            requestAnimationFrame(() => {
                              document
                                .querySelector(`.am-branch-item[data-index="${next}"]`)
                                ?.scrollIntoView({ block: "nearest" })
                            })
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault()
                            e.stopPropagation()
                            const prev = Math.max(highlightedIndex() - 1, 0)
                            setHighlightedIndex(prev)
                            requestAnimationFrame(() => {
                              document
                                .querySelector(`.am-branch-item[data-index="${prev}"]`)
                                ?.scrollIntoView({ block: "nearest" })
                            })
                          } else if (e.key === "Enter") {
                            e.preventDefault()
                            e.stopPropagation()
                            const selected = items[highlightedIndex()]
                            if (selected) {
                              setBaseBranch(selected.name)
                              setBaseBranchOpen(false)
                              setBranchSearch("")
                              setHighlightedIndex(0)
                            }
                          } else if (e.key === "Escape") {
                            e.preventDefault()
                            e.stopPropagation()
                            setBaseBranchOpen(false)
                            setBranchSearch("")
                            setHighlightedIndex(0)
                          }
                        }}
                        selected={effectiveBaseBranch()}
                        highlighted={highlightedIndex()}
                        onHighlight={setHighlightedIndex}
                        searchPlaceholder={t("agentManager.dialog.searchBranches")}
                        emptyLabel={t("agentManager.import.noMatchingBranches")}
                        defaultLabel={t("agentManager.dialog.branchBadge.default")}
                        remoteLabel={t("agentManager.dialog.branchBadge.remote")}
                        defaultName={defaultBranch()}
                      />
                    </Popover>
                  </div>
                </div>
              </div>
            </Show>

            {/* Version / compare mode selector */}
            <Show
              when={compareMode()}
              fallback={
                <div class="am-nv-version-bar">
                  <span class="am-nv-config-label">{t("agentManager.dialog.versions")}</span>
                  <div class="am-nv-pills">
                    {VERSION_OPTIONS.map((count) => (
                      <button
                        class="am-nv-pill"
                        classList={{ "am-nv-pill-active": versions() === count }}
                        onClick={() => setVersions(count)}
                        type="button"
                      >
                        {count}
                      </button>
                    ))}
                    <Tooltip
                      value={t("agentManager.dialog.compareModels.tooltip")}
                      placement="top"
                      contentClass="am-tooltip-wrap"
                    >
                      <button class="am-nv-pill am-nv-pill-compare" onClick={() => setCompareMode(true)} type="button">
                        <Icon name="layers" size="small" />
                        <span class="am-nv-pill-compare-label">{t("agentManager.dialog.compareModels")}</span>
                      </button>
                    </Tooltip>
                  </div>
                  <Show when={versions() > 1}>
                    <span class="am-nv-version-hint">
                      {t("agentManager.dialog.versionHint", { count: versions() })}
                    </span>
                  </Show>
                </div>
              }
            >
              <div class="am-nv-compare-section">
                <div class="am-nv-version-bar">
                  <span class="am-nv-config-label">
                    {t("agentManager.dialog.compareModels")}
                    <Show when={totalAllocations(modelAllocations()) > 0}>
                      <span class="am-nv-compare-count">
                        {totalAllocations(modelAllocations())}/{MAX_MULTI_VERSIONS}
                      </span>
                    </Show>
                  </span>
                  <button
                    class="am-nv-pill-back"
                    onClick={() => {
                      setCompareMode(false)
                      setModelAllocations(new Map())
                    }}
                    type="button"
                    title={t("agentManager.dialog.versions")}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </div>
                <Popover
                  open={compareOpen()}
                  onOpenChange={setCompareOpen}
                  placement="top-start"
                  flip={false}
                  sameWidth
                  class="am-compare-popover"
                  trigger={
                    <button class="am-selector-trigger" type="button">
                      <span class="am-selector-left">
                        <Icon name="layers" size="small" />
                        <Show
                          when={modelAllocations().size > 0}
                          fallback={
                            <span class="am-selector-value am-selector-placeholder">
                              {t("agentManager.dialog.compareModels.selectModels")}
                            </span>
                          }
                        >
                          <span class="am-selector-value">
                            {[...modelAllocations().values()].map((e) => e.name).join(", ")}
                          </span>
                        </Show>
                      </span>
                      <span class="am-selector-right">
                        <Icon name="selector" size="small" />
                      </span>
                    </button>
                  }
                >
                  <MultiModelSelector allocations={modelAllocations()} onChange={setModelAllocations} />
                </Popover>
              </div>
            </Show>
          </div>
          {/* Submit button — fixed footer, always visible */}
          <div class="am-nv-dialog-footer">
            <Button variant="primary" size="large" class="am-nv-submit" onClick={handleSubmit} disabled={!canSubmit()}>
              <Show
                when={!starting()}
                fallback={
                  <>
                    <Spinner class="am-nv-spinner" />
                    <span>{t("agentManager.dialog.creating")}</span>
                  </>
                }
              >
                {t("agentManager.dialog.createWorktree")}
              </Show>
            </Button>
          </div>
        </div>
      </Show>

      {/* Import tab */}
      <Show when={tab() === "import"}>
        <div class="am-import-tab">
          {/* Pull Request section */}
          <div class="am-import-section">
            <span class="am-nv-config-label">{t("agentManager.import.pullRequest")}</span>
            <div class="am-pr-row">
              <div class="am-pr-input-wrapper">
                <Icon name="branch" size="small" />
                <input
                  class="am-pr-input"
                  type="text"
                  placeholder={t("agentManager.import.pastePrUrl")}
                  value={prUrl()}
                  onInput={(e) => setPrUrl(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handlePRSubmit()
                    }
                  }}
                  disabled={isPending()}
                />
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={handlePRSubmit}
                disabled={!prUrl().trim() || isPending()}
              >
                <Show when={prPending()} fallback={t("agentManager.import.open")}>
                  <Spinner class="am-nv-spinner" />
                </Show>
              </Button>
            </div>
          </div>

          <div class="am-import-divider" />

          {/* Branches section */}
          <div class="am-import-section">
            <span class="am-nv-config-label">{t("agentManager.import.branches")}</span>
            <div class="am-selector-wrapper">
              <Popover
                open={branchOpen()}
                onOpenChange={setBranchOpen}
                placement="top-start"
                flip={false}
                sameWidth
                portal={false}
                class="am-dropdown"
                trigger={
                  <button class="am-selector-trigger" disabled={isPending()} type="button">
                    <span class="am-selector-left">
                      <Icon name="branch" size="small" />
                      <span class="am-selector-value">
                        {branchesLoading() ? t("agentManager.import.loading") : t("agentManager.import.selectBranch")}
                      </span>
                    </span>
                    <span class="am-selector-right">
                      <Icon name="selector" size="small" />
                    </span>
                  </button>
                }
              >
                <BranchSelect
                  branches={filteredBranches().filter((b) => !b.isCheckedOut)}
                  loading={branchesLoading()}
                  search={branchSearch()}
                  onSearch={setBranchSearch}
                  onSelect={(b) => handleBranchSelect(b.name)}
                  searchPlaceholder={t("agentManager.dialog.searchBranches")}
                  loadingLabel={t("agentManager.import.loadingBranches")}
                  emptyLabel={t("agentManager.import.noMatchingBranches")}
                  defaultLabel={t("agentManager.dialog.branchBadge.default")}
                  remoteLabel={t("agentManager.dialog.branchBadge.remote")}
                />
              </Popover>
            </div>
          </div>

          {/* Empty state when no branches are available */}
          <Show when={!branchesLoading() && branches().length === 0}>
            <div class="am-import-empty">
              {t("agentManager.import.noBranchesFound")}
              <br />
              {t("agentManager.import.noBranchesHint")}
            </div>
          </Show>
        </div>
      </Show>
    </Dialog>
  )
}
